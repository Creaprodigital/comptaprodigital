import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  beginMfaSetup,
  changePassword,
  completeMfaLogin,
  disableMfa,
  enableMfa,
  login,
  logout,
  registerUser,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
} from "@/server/auth/auth-service";
import { currentTotpCode } from "@/server/auth/mfa";
import { createSession, validateSessionToken } from "@/server/auth/session-store";
import { PASSWORD, clearRateLimits, createVerifiedUser, lastMailTo, loginAs, mailsTo, prisma, resetDatabase, tokenFromMail } from "./helpers";

const registration = (email: string) => ({ firstName: "Ada", lastName: "Martin", email, password: PASSWORD, plan: "PRO" as const, acceptTerms: true as const });

beforeAll(resetDatabase);
beforeEach(clearRateLimits);

describe("inscription et vérification de l'adresse e-mail", () => {
  it("crée le compte, démarre l'essai et envoie le lien de confirmation", async () => {
    await registerUser(registration("nouveau@exemple.test"));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nouveau@exemple.test" }, include: { subscription: { include: { plan: true } } } });

    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.termsAcceptedAt).not.toBeNull();
    expect(user.subscription?.status).toBe("TRIALING");
    expect(user.subscription?.plan.key).toBe("PRO");
    expect(user.subscription!.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(lastMailTo("nouveau@exemple.test").subject).toContain("Confirmez votre adresse e-mail");
  });

  it("refuse la connexion tant que l'adresse n'est pas confirmée", async () => {
    await expect(login({ email: "nouveau@exemple.test", password: PASSWORD })).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("ne stocke que l'empreinte du jeton et n'accepte le lien qu'une fois", async () => {
    const token = tokenFromMail(lastMailTo("nouveau@exemple.test"));
    const stored = await prisma.verificationToken.findMany({ where: { user: { email: "nouveau@exemple.test" } } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(token);

    await verifyEmail(token);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nouveau@exemple.test" } });
    expect(user.emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(verifyEmail("jeton-inconnu-jeton-inconnu-jeton")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("refuse un lien expiré", async () => {
    await registerUser(registration("expire@exemple.test"));
    await prisma.verificationToken.updateMany({ where: { user: { email: "expire@exemple.test" } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyEmail(tokenFromMail(lastMailTo("expire@exemple.test")))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("ne révèle pas qu'une adresse est déjà inscrite et ne crée pas de doublon", async () => {
    await expect(registerUser(registration("nouveau@exemple.test"))).resolves.toBeUndefined();
    expect(await prisma.user.count({ where: { email: "nouveau@exemple.test" } })).toBe(1);
    expect(lastMailTo("nouveau@exemple.test").subject).toContain("Vous avez déjà un compte");
  });

  it("renvoie un lien uniquement aux comptes en attente, sans le signaler", async () => {
    await registerUser(registration("attente@exemple.test"));
    const before = mailsTo("attente@exemple.test").length;
    await resendVerificationEmail("attente@exemple.test");
    expect(mailsTo("attente@exemple.test")).toHaveLength(before + 1);
    await expect(resendVerificationEmail("inconnu@exemple.test")).resolves.toBeUndefined();
    expect(mailsTo("inconnu@exemple.test")).toHaveLength(0);
  });
});

describe("fermeture des inscriptions", () => {
  it("refuse toute nouvelle inscription lorsque la plateforme les a fermées", async () => {
    await prisma.applicationSetting.update({ where: { key: "platform.registration_open" }, data: { value: false } });
    await expect(registerUser(registration("ferme@exemple.test"))).rejects.toMatchObject({ status: 403, code: "REGISTRATION_CLOSED" });
    expect(await prisma.user.count({ where: { email: "ferme@exemple.test" } })).toBe(0);
    await prisma.applicationSetting.update({ where: { key: "platform.registration_open" }, data: { value: true } });
    await expect(registerUser(registration("rouvert@exemple.test"))).resolves.toBeUndefined();
  });
});

describe("connexion", () => {
  it("ouvre une session valide avec les bons identifiants", async () => {
    const user = await createVerifiedUser({ email: "connexion@exemple.test" });
    const result = await login({ email: user.email, password: PASSWORD }, { ip: "203.0.113.7", userAgent: "vitest" });
    expect(result.status).toBe("authenticated");

    const auth = await validateSessionToken(result.token);
    expect(auth?.user.id).toBe(user.id);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: auth!.session.id } });
    expect(session.tokenHash).not.toBe(result.token);
    expect(session.ipAddress).toBe("203.0.113.7");
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: "auth.login" } })).toBe(1);
  });

  it("renvoie la même erreur pour un mauvais mot de passe et un compte inconnu", async () => {
    await expect(login({ email: "connexion@exemple.test", password: "Mauvais-MotDePasse-1!" })).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login({ email: "personne@exemple.test", password: PASSWORD })).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("verrouille temporairement le compte après cinq échecs", async () => {
    const user = await createVerifiedUser({ email: "verrou@exemple.test" });
    for (let i = 0; i < 5; i++) {
      await expect(login({ email: user.email, password: "Mauvais-MotDePasse-1!" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    // Même le bon mot de passe est refusé pendant le verrouillage.
    await expect(login({ email: user.email, password: PASSWORD })).rejects.toMatchObject({ status: 423, code: "ACCOUNT_LOCKED" });

    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await expect(login({ email: user.email, password: PASSWORD })).resolves.toMatchObject({ status: "authenticated" });
  });

  it("limite le nombre de tentatives par adresse e-mail", async () => {
    for (let i = 0; i < 10; i++) {
      await login({ email: "cible@exemple.test", password: "x" }).catch(() => undefined);
    }
    await expect(login({ email: "cible@exemple.test", password: "x" })).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("refuse un compte suspendu et invalide ses sessions", async () => {
    const user = await createVerifiedUser({ email: "suspendu@exemple.test" });
    const { token } = await login({ email: user.email, password: PASSWORD });
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    expect(await validateSessionToken(token)).toBeNull();
    await expect(login({ email: user.email, password: PASSWORD })).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });
});

describe("sessions", () => {
  it("rejette les sessions révoquées, expirées, inactives ou inconnues", async () => {
    const user = await createVerifiedUser({ email: "sessions@exemple.test" });
    const auth = await loginAs(user.email);

    const revoked = await createSession({ userId: user.id });
    await logout({ ...auth, session: { ...auth.session, id: revoked.sessionId } });
    expect(await validateSessionToken(revoked.token)).toBeNull();

    const expired = await createSession({ userId: user.id });
    await prisma.session.update({ where: { id: expired.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(expired.token)).toBeNull();

    const idle = await createSession({ userId: user.id });
    await prisma.session.update({ where: { id: idle.sessionId }, data: { lastSeenAt: new Date(Date.now() - 15 * 86_400_000) } });
    expect(await validateSessionToken(idle.token)).toBeNull();

    expect(await validateSessionToken("jeton-qui-n-existe-pas")).toBeNull();
    expect(await validateSessionToken("")).toBeNull();
  });
});

describe("double authentification", () => {
  it("s'active après vérification d'un code, puis s'impose à la connexion", async () => {
    const user = await createVerifiedUser({ email: "mfa@exemple.test" });
    const auth = await loginAs(user.email);

    const setup = await beginMfaSetup(auth);
    expect(setup.qrCodeDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mfaSecretEncrypted).not.toContain(setup.secret); // chiffré au repos
    expect(stored.mfaEnabledAt).toBeNull();

    await expect(enableMfa(auth, "000000")).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
    const { recoveryCodes } = await enableMfa(auth, currentTotpCode(stored.mfaSecretEncrypted!));
    expect(recoveryCodes).toHaveLength(10);

    // La connexion ne délivre plus qu'une session provisoire, sans aucun droit.
    const pending = await login({ email: user.email, password: PASSWORD });
    expect(pending.status).toBe("mfa_required");
    expect(await validateSessionToken(pending.token)).toBeNull();
    const pendingAuth = await validateSessionToken(pending.token, { allowMfaPending: true });
    expect(pendingAuth?.session.mfaPending).toBe(true);

    await expect(completeMfaLogin(pendingAuth!, "123456")).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
    const completed = await completeMfaLogin(pendingAuth!, currentTotpCode(stored.mfaSecretEncrypted!));
    expect(completed.status).toBe("authenticated");
    expect(await validateSessionToken(completed.token)).not.toBeNull();
    // La session provisoire est détruite : le jeton ne peut pas être rejoué.
    expect(await validateSessionToken(pending.token, { allowMfaPending: true })).toBeNull();
  });

  it("accepte un code de secours une seule fois", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "mfa@exemple.test" } });
    const auth = await validateSessionToken((await createSession({ userId: user.id })).token);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: null } });
    const { recoveryCodes } = await enableMfa(auth!, currentTotpCode(user.mfaSecretEncrypted!));

    const first = await login({ email: user.email, password: PASSWORD });
    const firstPending = await validateSessionToken(first.token, { allowMfaPending: true });
    await expect(completeMfaLogin(firstPending!, recoveryCodes[0].toLowerCase())).resolves.toMatchObject({ status: "authenticated" });

    const second = await login({ email: user.email, password: PASSWORD });
    const secondPending = await validateSessionToken(second.token, { allowMfaPending: true });
    await expect(completeMfaLogin(secondPending!, recoveryCodes[0])).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
  });

  it("se désactive uniquement avec le mot de passe", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "mfa@exemple.test" } });
    const auth = await validateSessionToken((await createSession({ userId: user.id })).token);
    await expect(disableMfa(auth!, "Mauvais-MotDePasse-1!")).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await disableMfa(auth!, PASSWORD);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mfaEnabledAt).toBeNull();
    expect(after.mfaSecretEncrypted).toBeNull();
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("mot de passe", () => {
  it("réinitialise par lien à usage unique et déconnecte toutes les sessions", async () => {
    const user = await createVerifiedUser({ email: "oubli@exemple.test" });
    const { token: sessionToken } = await login({ email: user.email, password: PASSWORD });

    await requestPasswordReset(user.email);
    const resetToken = tokenFromMail(lastMailTo(user.email));
    await resetPassword(resetToken, "Nouveau-MotDePasse-2027!");

    expect(await validateSessionToken(sessionToken)).toBeNull();
    await expect(login({ email: user.email, password: PASSWORD })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(login({ email: user.email, password: "Nouveau-MotDePasse-2027!" })).resolves.toMatchObject({ status: "authenticated" });
    await expect(resetPassword(resetToken, "Encore-Un-Autre-2028!")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(lastMailTo(user.email).subject).toContain("Votre mot de passe a été modifié");
  });

  it("ne révèle pas l'existence d'un compte lors d'une demande de réinitialisation", async () => {
    await expect(requestPasswordReset("fantome@exemple.test")).resolves.toBeUndefined();
    expect(mailsTo("fantome@exemple.test")).toHaveLength(0);
  });

  it("exige le mot de passe actuel pour en changer et déconnecte les autres appareils", async () => {
    const user = await createVerifiedUser({ email: "changement@exemple.test" });
    const current = await loginAs(user.email);
    const other = await login({ email: user.email, password: PASSWORD });

    await expect(changePassword(current, { currentPassword: "Mauvais-MotDePasse-1!", newPassword: "Nouveau-MotDePasse-2027!" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(changePassword(current, { currentPassword: PASSWORD, newPassword: PASSWORD })).rejects.toMatchObject({ code: "SAME_PASSWORD" });
    await changePassword(current, { currentPassword: PASSWORD, newPassword: "Nouveau-MotDePasse-2027!" });

    expect(await validateSessionToken(other.token)).toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: current.session.id } })).revokedAt).toBeNull();
  });
});

describe("journal d'audit", () => {
  it("ne contient jamais de secret", async () => {
    const logs = await prisma.auditLog.findMany();
    expect(logs.length).toBeGreaterThan(10);
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("$argon2id$");
  });
});
