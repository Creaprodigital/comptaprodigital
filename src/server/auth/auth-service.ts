import type { User, VerificationTokenType } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { generateToken, hashToken } from "@/server/security/crypto";
import { enforceRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { createSession, revokeAllUserSessions, revokeSession, type AuthContext } from "@/server/auth/session-store";
import { generateMfaSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotpCode } from "@/server/auth/mfa";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  PASSWORD_RESET_TTL_MINUTES,
} from "@/server/auth/constants";
import type { RegisterInput } from "@/lib/schemas/auth";

type Meta = { ip?: string | null; userAgent?: string | null };

// ---------------------------------------------------------------------------
// Jetons à usage unique (vérification d'e-mail, réinitialisation)
// ---------------------------------------------------------------------------

async function issueVerificationToken(userId: string, type: VerificationTokenType, ttlMs: number): Promise<string> {
  const token = generateToken();
  await prisma.$transaction([
    // Un seul jeton actif par usage : les précédents sont invalidés.
    prisma.verificationToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.verificationToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

async function consumeVerificationToken(token: string, type: VerificationTokenType) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw errors.badRequest("INVALID_TOKEN", "Ce lien est invalide ou a expiré. Demandez-en un nouveau.");
  }
  // Marquage atomique : un lien ne peut servir qu'une fois, même en cas d'appels concurrents.
  const claimed = await prisma.verificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw errors.badRequest("INVALID_TOKEN", "Ce lien a déjà été utilisé.");
  }
  return record;
}

async function sendVerificationEmail(user: Pick<User, "id" | "email" | "firstName">) {
  const token = await issueVerificationToken(user.id, "EMAIL_VERIFICATION", EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);
  await sendMail(mailTemplates.verifyEmail(user.email, user.firstName, token));
}

// ---------------------------------------------------------------------------
// Inscription et vérification d'adresse e-mail
// ---------------------------------------------------------------------------

/**
 * Crée le compte et démarre la période d'essai de la formule choisie.
 * La réponse est identique que l'adresse soit déjà utilisée ou non, afin de ne
 * pas révéler l'existence d'un compte (le titulaire est prévenu par e-mail).
 */
export async function registerUser(input: RegisterInput, meta: Meta = {}): Promise<void> {
  // Paramètre global de la plateforme (pilotable depuis l'administration).
  const registration = await prisma.applicationSetting.findUnique({ where: { key: "platform.registration_open" } });
  if (registration?.value === false) {
    throw new AppError(403, "REGISTRATION_CLOSED", "Les inscriptions sont momentanément fermées. Contactez-nous pour être prévenu de leur réouverture.");
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    // Coût équivalent à une inscription réelle.
    await hashPassword(input.password);
    if (existing.status === "ACTIVE") {
      if (existing.emailVerifiedAt) {
        await sendMail(mailTemplates.accountAlreadyExists(existing.email, existing.firstName));
      } else {
        await sendVerificationEmail(existing);
      }
    }
    await recordAudit({ action: "auth.register.duplicate", userId: existing.id, ...meta });
    return;
  }

  const plan = await prisma.subscriptionPlan.findFirst({ where: { key: input.plan, isActive: true } });
  if (!plan) throw errors.badRequest("PLAN_UNAVAILABLE", "La formule sélectionnée n'est pas disponible.");

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      termsAcceptedAt: now,
      subscription: {
        create: {
          planId: plan.id,
          status: "TRIALING",
          trialEndsAt: new Date(now.getTime() + plan.trialDays * 86_400_000),
        },
      },
    },
  });

  await sendVerificationEmail(user);
  await recordAudit({ action: "auth.register", userId: user.id, metadata: { plan: plan.key }, ...meta });
}

export async function verifyEmail(token: string, meta: Meta = {}): Promise<void> {
  const record = await consumeVerificationToken(token, "EMAIL_VERIFICATION");
  if (!record.user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await prisma.notification.create({
      data: {
        userId: record.userId,
        type: "welcome",
        title: "Bienvenue sur ComptaPro Digital",
        body: "Votre adresse e-mail est confirmée. Ajoutez votre entreprise pour commencer.",
        link: "/app/entreprises",
      },
    });
  }
  await recordAudit({ action: "auth.email_verified", userId: record.userId, ...meta });
}

/** Renvoi du lien de vérification — réponse volontairement identique dans tous les cas. */
export async function resendVerificationEmail(email: string): Promise<void> {
  await enforceRateLimit(RATE_LIMITS.emailToken, `verify:${email}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === "ACTIVE" && !user.emailVerifiedAt) {
    await sendVerificationEmail(user);
  }
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

export type LoginResult = {
  status: "authenticated" | "mfa_required";
  token: string;
  expiresAt: Date;
};

const INVALID_CREDENTIALS = () => new AppError(401, "INVALID_CREDENTIALS", "Adresse e-mail ou mot de passe incorrect.");

export async function login(input: { email: string; password: string }, meta: Meta = {}): Promise<LoginResult> {
  await enforceRateLimit(RATE_LIMITS.loginPerEmail, `login:${input.email}`);

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.status === "DELETED") {
    await verifyAgainstDummy(input.password);
    throw INVALID_CREDENTIALS();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError(423, "ACCOUNT_LOCKED", "Compte temporairement verrouillé après plusieurs échecs. Réessayez dans quelques minutes.");
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await recordAudit({ action: lock ? "auth.login.locked" : "auth.login.failed", userId: user.id, ...meta });
    throw INVALID_CREDENTIALS();
  }

  if (user.status === "SUSPENDED") {
    throw new AppError(403, "ACCOUNT_SUSPENDED", "Ce compte est suspendu. Contactez le support.");
  }
  if (!user.emailVerifiedAt) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Confirmez votre adresse e-mail avant de vous connecter.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

  if (user.mfaEnabledAt) {
    const pending = await createSession({ userId: user.id, mfaPending: true, ...meta });
    await recordAudit({ action: "auth.login.mfa_challenge", userId: user.id, ...meta });
    return { status: "mfa_required", token: pending.token, expiresAt: pending.expiresAt };
  }

  return finalizeLogin(user.id, meta);
}

async function finalizeLogin(userId: string, meta: Meta): Promise<LoginResult> {
  // Reprise de la dernière entreprise active, si l'utilisateur en est toujours membre.
  const lastMembership = await prisma.companyUser.findFirst({
    where: { userId, status: "ACTIVE", company: { status: { not: "ARCHIVED" } } },
    orderBy: { joinedAt: "asc" },
    select: { companyId: true },
  });
  const session = await createSession({ userId, activeCompanyId: lastMembership?.companyId ?? null, ...meta });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await recordAudit({ action: "auth.login", userId, ...meta });
  return { status: "authenticated", token: session.token, expiresAt: session.expiresAt };
}

/** Réserve un pas de temps TOTP : échoue si ce pas (ou un pas plus récent) a déjà servi. */
async function claimTotpStep(userId: string, step: number): Promise<boolean> {
  const claimed = await prisma.user.updateMany({
    where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
    data: { mfaLastUsedStep: step },
  });
  return claimed.count === 1;
}

/** Étape 2 de la connexion : code TOTP ou code de secours. La session provisoire est remplacée. */
export async function completeMfaLogin(pending: AuthContext, code: string, meta: Meta = {}): Promise<LoginResult> {
  await enforceRateLimit(RATE_LIMITS.mfaVerify, `mfa:${pending.user.id}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.user.id } });
  if (!user.mfaEnabledAt || !user.mfaSecretEncrypted) throw errors.unauthenticated();

  const step = verifyTotpCode(user.mfaSecretEncrypted, code);
  // Anti-rejeu : le pas de temps n'est accepté qu'une fois (réservation atomique en base).
  let valid = step !== null && (await claimTotpStep(user.id, step));
  if (step !== null && !valid) await recordAudit({ action: "auth.mfa.replay_rejected", userId: user.id, ...meta });
  if (!valid && step === null) {
    const claimed = await prisma.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    valid = claimed.count === 1;
    if (valid) await recordAudit({ action: "auth.mfa.recovery_code_used", userId: user.id, ...meta });
  }

  if (!valid) {
    await recordAudit({ action: "auth.mfa.failed", userId: user.id, ...meta });
    throw new AppError(401, "INVALID_MFA_CODE", "Code de vérification incorrect.");
  }

  await revokeSession(pending.session.id);
  return finalizeLogin(user.id, meta);
}

export async function logout(auth: AuthContext, meta: Meta = {}): Promise<void> {
  await revokeSession(auth.session.id);
  await recordAudit({ action: "auth.logout", userId: auth.user.id, ...meta });
}

// ---------------------------------------------------------------------------
// Mot de passe
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string, meta: Meta = {}): Promise<void> {
  await enforceRateLimit(RATE_LIMITS.passwordReset, `reset:${email}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return; // Réponse identique : pas d'énumération de comptes.
  const token = await issueVerificationToken(user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MINUTES * 60_000);
  await sendMail(mailTemplates.passwordReset(user.email, user.firstName, token));
  await recordAudit({ action: "auth.password_reset.requested", userId: user.id, ...meta });
}

export async function resetPassword(token: string, newPassword: string, meta: Meta = {}): Promise<void> {
  const record = await consumeVerificationToken(token, "PASSWORD_RESET");
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: record.userId },
    data: {
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      // Le lien a été reçu par e-mail : l'adresse est de fait vérifiée.
      emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
    },
  });
  await revokeAllUserSessions(record.userId);
  await sendMail(mailTemplates.passwordChanged(record.user.email, record.user.firstName));
  await recordAudit({ action: "auth.password_reset.completed", userId: record.userId, ...meta });
}

export async function changePassword(
  auth: AuthContext,
  input: { currentPassword: string; newPassword: string },
  meta: Meta = {},
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw errors.badRequest("INVALID_PASSWORD", "Le mot de passe actuel est incorrect.");
  }
  if (input.currentPassword === input.newPassword) {
    throw errors.badRequest("SAME_PASSWORD", "Le nouveau mot de passe doit être différent de l'ancien.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
  await revokeAllUserSessions(user.id, auth.session.id);
  await sendMail(mailTemplates.passwordChanged(user.email, user.firstName));
  await recordAudit({ action: "auth.password_changed", userId: user.id, ...meta });
}

// ---------------------------------------------------------------------------
// Double authentification
// ---------------------------------------------------------------------------

/** Étape 1 : génère un secret (non actif tant qu'un premier code n'a pas été validé). */
export async function beginMfaSetup(auth: AuthContext): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
  if (auth.user.mfaEnabledAt) {
    throw errors.conflict("MFA_ALREADY_ENABLED", "La double authentification est déjà activée.");
  }
  const { secretBase32, encryptedSecret, otpauthUrl } = generateMfaSecret(auth.user.email);
  await prisma.user.update({ where: { id: auth.user.id }, data: { mfaSecretEncrypted: encryptedSecret } });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret: secretBase32, otpauthUrl, qrCodeDataUrl };
}

/** Étape 2 : active la double authentification et retourne les codes de secours (affichés une seule fois). */
export async function enableMfa(auth: AuthContext, code: string, meta: Meta = {}): Promise<{ recoveryCodes: string[] }> {
  await enforceRateLimit(RATE_LIMITS.mfaVerify, `mfa:${auth.user.id}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (user.mfaEnabledAt) throw errors.conflict("MFA_ALREADY_ENABLED", "La double authentification est déjà activée.");
  if (!user.mfaSecretEncrypted) throw errors.badRequest("MFA_NOT_INITIALIZED", "Commencez par générer un QR code.");
  const step = verifyTotpCode(user.mfaSecretEncrypted, code);
  if (step === null || !(await claimTotpStep(user.id, step))) {
    throw errors.badRequest("INVALID_MFA_CODE", "Code de vérification incorrect.");
  }
  const { codes, hashes } = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) }),
  ]);
  await revokeAllUserSessions(user.id, auth.session.id);
  await recordAudit({ action: "auth.mfa.enabled", userId: user.id, ...meta });
  return { recoveryCodes: codes };
}

export async function disableMfa(auth: AuthContext, password: string, meta: Meta = {}): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw errors.badRequest("INVALID_PASSWORD", "Mot de passe incorrect.");
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null, mfaLastUsedStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  await recordAudit({ action: "auth.mfa.disabled", userId: user.id, ...meta });
}
