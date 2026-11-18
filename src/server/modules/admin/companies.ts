import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { companyOwnerStanding } from "@/server/billing/standing";

/** Entreprises vues de l'administration : identité et statut, jamais leurs données comptables. */

type Meta = { ip?: string | null; userAgent?: string | null };

export async function listCompanies(filter: { q?: string; status?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where: Prisma.CompanyWhereInput = {};
  if (filter.status === "ACTIVE" || filter.status === "SUSPENDED" || filter.status === "ARCHIVED") where.status = filter.status;
  if (filter.q) where.OR = [{ name: { contains: filter.q } }, { siren: { contains: filter.q.replace(/\s/g, "") } }, { createdBy: { email: { contains: filter.q } } }];
  const [rows, total] = await Promise.all([
    prisma.company.findMany({
      where,
      select: { id: true, name: true, siren: true, legalForm: true, status: true, createdAt: true, createdBy: { select: { id: true, email: true } }, _count: { select: { members: { where: { status: "ACTIVE" } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 30,
      take: 30,
    }),
    prisma.company.count({ where }),
  ]);
  return { items: rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), members: c._count.members })), total, page, pageSize: 30 };
}

export async function getCompanyAdmin(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      siren: true,
      legalForm: true,
      taxRegime: true,
      vatRegime: true,
      accountingMode: true,
      city: true,
      status: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
      members: { where: { status: "ACTIVE" }, select: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, role: { select: { key: true, name: true } } } },
    },
  });
  if (!company) throw errors.notFound("Entreprise introuvable.");
  return {
    ...company,
    createdAt: company.createdAt.toISOString(),
    suspendedAt: company.suspendedAt?.toISOString() ?? null,
    ownerStanding: await companyOwnerStanding(companyId),
    members: company.members.map((m) => ({ userId: m.user.id, email: m.user.email, name: `${m.user.firstName} ${m.user.lastName}`, role: m.role.name, owner: m.role.key === "OWNER" })),
  };
}

export async function setCompanyStatus(adminId: string, companyId: string, status: "ACTIVE" | "SUSPENDED", reason: string | null, meta: Meta = {}) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw errors.notFound("Entreprise introuvable.");
  if (company.status === "ARCHIVED") throw errors.conflict("COMPANY_ARCHIVED", "Cette entreprise est archivée par son titulaire.");
  if (status === "SUSPENDED" && (!reason || reason.trim().length < 10)) throw errors.validation([{ path: "reason", message: "Indiquez le motif de la suspension (10 caractères au moins)" }]);
  await prisma.company.update({ where: { id: companyId }, data: status === "SUSPENDED" ? { status, suspendedAt: new Date(), suspendedReason: reason!.slice(0, 255) } : { status, suspendedAt: null, suspendedReason: null } });
  await recordAudit({ action: status === "SUSPENDED" ? "admin.company_suspended" : "admin.company_reactivated", userId: adminId, actorType: "SUPER_ADMIN", companyId, entityType: "Company", entityId: companyId, metadata: { reason }, ...meta });
}
