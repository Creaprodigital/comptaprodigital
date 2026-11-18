import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { notify } from "@/server/modules/notifications/service";
import { getDashboard } from "@/server/modules/dashboard/service";
import { toMoneyString } from "@/lib/money";
import { toIsoDate } from "@/lib/dates";
import { getSetting } from "./settings";

/**
 * Accès justifié d'un administrateur aux données financières d'une entreprise
 * (par exemple pour instruire une demande de support) :
 *  - limité : en lecture seule, à une synthèse, pour une durée bornée ;
 *  - justifié : motif obligatoire ;
 *  - journalisé : ouverture, chaque consultation et la révocation sont inscrites au journal d'audit ;
 *  - contrôlé : le titulaire est prévenu (notification et e-mail) et peut révoquer l'accès.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

export async function requestAccess(adminId: string, companyId: string, input: { reason: string; hours: number }, meta: Meta = {}) {
  const maxHours = await getSetting("admin.access_grant_max_hours");
  if (input.reason.trim().length < 20) throw errors.validation([{ path: "reason", message: "Justifiez l'accès (20 caractères au moins : demande de support, référence…)" }]);
  if (input.hours < 1 || input.hours > maxHours) throw errors.validation([{ path: "hours", message: `Durée comprise entre 1 et ${maxHours} heures` }]);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw errors.notFound("Entreprise introuvable.");
  const expiresAt = new Date(Date.now() + input.hours * 3600_000);
  const grant = await prisma.adminDataAccessGrant.create({ data: { adminUserId: adminId, companyId, reason: input.reason.trim().slice(0, 500), expiresAt } });
  await recordAudit({ action: "admin.data_access_granted", userId: adminId, actorType: "SUPER_ADMIN", companyId, entityType: "AdminDataAccessGrant", entityId: grant.id, metadata: { reason: grant.reason, expiresAt: expiresAt.toISOString() }, ...meta });
  // Le titulaire est prévenu immédiatement.
  const owner = await prisma.companyUser.findFirst({ where: { companyId, status: "ACTIVE", role: { key: "OWNER" } }, select: { user: { select: { id: true, email: true, firstName: true } } } });
  if (owner) {
    await notify(owner.user.id, { type: "admin.data_access", title: `Accès du support aux données de ${company.name}`, body: `Motif : ${grant.reason}`, link: "/app/entreprise/equipe", companyId });
    await sendMail(mailTemplates.adminAccessGranted(owner.user.email, owner.user.firstName, company.name, grant.reason, expiresAt)).catch((error) => console.error("[admin] e-mail d'accès", error));
  }
  return grant;
}

/** Accès en cours d'un administrateur sur une entreprise (non expiré, non révoqué). */
export async function activeGrant(adminId: string, companyId: string) {
  return prisma.adminDataAccessGrant.findFirst({ where: { adminUserId: adminId, companyId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } });
}

export async function revokeGrant(actorId: string, grantId: string, by: "admin" | "owner", meta: Meta = {}) {
  const grant = await prisma.adminDataAccessGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.revokedAt) throw errors.notFound("Accès introuvable.");
  if (by === "owner") {
    const owner = await prisma.companyUser.findFirst({ where: { companyId: grant.companyId, userId: actorId, status: "ACTIVE", role: { key: { in: ["OWNER", "COMPANY_ADMIN"] } } } });
    if (!owner) throw errors.notFound("Accès introuvable.");
  } else if (grant.adminUserId !== actorId) {
    throw errors.notFound("Accès introuvable.");
  }
  await prisma.adminDataAccessGrant.update({ where: { id: grantId }, data: { revokedAt: new Date(), revokedById: actorId } });
  await recordAudit({ action: "admin.data_access_revoked", userId: actorId, actorType: by === "admin" ? "SUPER_ADMIN" : "USER", companyId: grant.companyId, entityType: "AdminDataAccessGrant", entityId: grantId, metadata: { by }, ...meta });
}

/** Accès accordés sur une entreprise, avec le nombre de consultations (vue du titulaire ou de l'administration). */
export async function listGrants(companyId: string) {
  const grants = await prisma.adminDataAccessGrant.findMany({ where: { companyId }, include: { admin: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const views = await prisma.auditLog.groupBy({ by: ["entityId"], where: { companyId, action: "admin.financial_data_view" }, _count: { _all: true } });
  const now = new Date();
  return grants.map((g) => ({
    id: g.id,
    admin: `${g.admin.firstName} ${g.admin.lastName}`,
    adminEmail: g.admin.email,
    reason: g.reason,
    createdAt: g.createdAt.toISOString(),
    expiresAt: g.expiresAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
    active: !g.revokedAt && g.expiresAt > now,
    views: views.find((v) => v.entityId === g.id)?._count._all ?? 0,
  }));
}

/** Synthèse financière consultable pendant un accès justifié. Chaque consultation est journalisée. */
export async function financialSnapshot(adminId: string, companyId: string, meta: Meta = {}) {
  const grant = await activeGrant(adminId, companyId);
  if (!grant) throw errors.forbidden("Aucun accès justifié en cours sur cette entreprise.");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const [dashboard, invoices, accounts] = await Promise.all([
    getDashboard(company, { preset: "year" }),
    prisma.invoice.findMany({ where: { companyId, status: { not: "DRAFT" } }, select: { number: true, type: true, status: true, issueDate: true, totalInclTax: true, amountPaid: true, customer: { select: { name: true } } }, orderBy: { issueDate: "desc" }, take: 20 }),
    prisma.bankAccount.findMany({ where: { companyId }, select: { name: true, bankName: true, ibanLast4: true, isActive: true } }),
  ]);
  await recordAudit({ action: "admin.financial_data_view", userId: adminId, actorType: "SUPER_ADMIN", companyId, entityType: "AdminDataAccessGrant", entityId: grant.id, metadata: { reason: grant.reason }, ...meta });
  return {
    grant: { id: grant.id, reason: grant.reason, expiresAt: grant.expiresAt.toISOString() },
    kpis: dashboard.kpis,
    alerts: dashboard.alerts.map((a) => a.title),
    invoices: invoices.map((i) => ({ number: i.number, type: i.type, status: i.status, issueDate: i.issueDate ? toIsoDate(i.issueDate) : null, total: toMoneyString(i.totalInclTax), paid: toMoneyString(i.amountPaid), customer: i.customer.name })),
    bankAccounts: accounts,
  };
}
