import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { verifyTotpCode } from "@/server/auth/mfa";
import type { AuthContext } from "@/server/auth/session-store";
import { getStripe } from "@/server/billing/stripe";

/**
 * Suppression du compte par son titulaire (droit à l'effacement), dans le respect des
 * obligations de conservation :
 *  - les données personnelles du compte sont effacées ou anonymisées, les sessions fermées ;
 *  - l'abonnement est résilié immédiatement ;
 *  - les entreprises dont il est le seul membre sont archivées : leurs pièces et écritures
 *    comptables restent conservées dix ans (Code de commerce, art. L123-22), sans accès ;
 *  - une entreprise partagée avec d'autres membres doit d'abord leur être retirée, faute de
 *    transfert de propriété automatique.
 * Le journal d'audit est conservé (intérêt légitime : sécurité, preuve), rattaché à l'identifiant anonymisé.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

export type DeletionCheck = { allowed: boolean; blockers: string[]; companiesToArchive: Array<{ id: string; name: string }> };

export async function deletionCheck(userId: string): Promise<DeletionCheck> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isSuperAdmin: true } });
  const owned = await prisma.companyUser.findMany({
    where: { userId, status: "ACTIVE", role: { key: "OWNER" } },
    select: { company: { select: { id: true, name: true, status: true, members: { where: { status: "ACTIVE", userId: { not: userId } }, select: { id: true } } } } },
  });
  const blockers: string[] = [];
  if (user.isSuperAdmin) blockers.push("Un compte d'administrateur de la plateforme ne peut pas être supprimé depuis l'application.");
  for (const { company } of owned) {
    if (company.members.length > 0) blockers.push(`« ${company.name} » compte d'autres membres : retirez-les (Équipe et accès) avant de supprimer votre compte.`);
  }
  return { allowed: blockers.length === 0, blockers, companiesToArchive: owned.filter((o) => o.company.members.length === 0 && o.company.status !== "ARCHIVED").map((o) => ({ id: o.company.id, name: o.company.name })) };
}

export async function deleteAccount(auth: AuthContext, input: { password: string; code?: string | null; confirmation: string }, meta: Meta = {}) {
  if (input.confirmation.trim().toUpperCase() !== "SUPPRIMER") throw errors.validation([{ path: "confirmation", message: "Saisissez SUPPRIMER pour confirmer" }]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, include: { subscription: true } });
  if (!(await verifyPassword(user.passwordHash, input.password))) throw errors.badRequest("INVALID_PASSWORD", "Mot de passe incorrect.");
  if (user.mfaEnabledAt && user.mfaSecretEncrypted && (!input.code || verifyTotpCode(user.mfaSecretEncrypted, input.code) === null)) {
    throw errors.badRequest("INVALID_MFA_CODE", "Code de double authentification incorrect.");
  }
  const check = await deletionCheck(user.id);
  if (!check.allowed) throw new AppError(409, "DELETION_BLOCKED", check.blockers.join(" "));

  // Résiliation immédiate de l'abonnement payant.
  const sub = user.subscription;
  if (sub?.stripeSubscriptionId && !["CANCELED", "EXPIRED"].includes(sub.status)) {
    const stripe = getStripe();
    if (stripe) await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  }

  const original = { email: user.email, firstName: user.firstName };
  const now = new Date();
  await prisma.$transaction([
    ...check.companiesToArchive.map((c) => prisma.company.update({ where: { id: c.id }, data: { status: "ARCHIVED" } })),
    prisma.companyUser.updateMany({ where: { userId: user.id, status: "ACTIVE" }, data: { status: "REVOKED" } }),
    ...(sub ? [prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false } })] : []),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.verificationToken.deleteMany({ where: { userId: user.id } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.notification.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        status: "DELETED",
        deletedAt: now,
        email: `supprime-${user.id}@supprime.invalid`,
        firstName: "Compte",
        lastName: "supprimé",
        phone: null,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        mfaSecretEncrypted: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        emailVerifiedAt: null,
      },
    }),
  ]);
  // Les coordonnées laissées dans les demandes de support sont effacées.
  await prisma.supportTicket.updateMany({ where: { userId: user.id }, data: { contactName: "Compte supprimé", contactEmail: null } });
  await recordAudit({ action: "account.deleted", userId: user.id, metadata: { archivedCompanies: check.companiesToArchive.map((c) => c.id) }, ...meta });
  await sendMail(mailTemplates.accountDeleted(original.email, original.firstName)).catch((error) => console.error("[compte] e-mail de suppression", error));
  return { archivedCompanies: check.companiesToArchive };
}
