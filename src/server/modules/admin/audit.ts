import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { fromIsoDate } from "@/lib/dates";
import type { AuditQuery } from "@/lib/schemas/admin";

/** Consultation du journal d'audit (lecture seule : aucune suppression possible depuis l'interface). */

function whereOf(filter: AuditQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { startsWith: filter.action };
  if (filter.actorType) where.actorType = filter.actorType;
  if (filter.companyId) where.companyId = filter.companyId;
  if (filter.userId) where.userId = filter.userId;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: fromIsoDate(filter.from) } : {}),
      ...(filter.to ? { lt: new Date(fromIsoDate(filter.to).getTime() + 86400_000) } : {}),
    };
  }
  return where;
}

const include = { user: { select: { email: true } }, company: { select: { name: true } } } as const;

type Row = Prisma.AuditLogGetPayload<{ include: typeof include }>;
const serialize = (r: Row) => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  action: r.action,
  actorType: r.actorType,
  user: r.user?.email ?? null,
  userId: r.userId,
  company: r.company?.name ?? null,
  companyId: r.companyId,
  entity: r.entityType ? `${r.entityType}${r.entityId ? ` ${r.entityId}` : ""}` : null,
  metadata: r.metadata,
  ip: r.ipAddress,
});

export async function listAudit(filter: AuditQuery) {
  const page = filter.page ?? 1;
  const where = whereOf(filter);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditLog.count({ where }),
  ]);
  return { items: rows.map(serialize), total, page, pageSize: 50 };
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  // Neutralise les formules à l'ouverture dans un tableur.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Export CSV (10 000 lignes au plus par export). */
export async function exportAuditCsv(filter: AuditQuery): Promise<string> {
  const rows = await prisma.auditLog.findMany({ where: whereOf(filter), include, orderBy: { createdAt: "desc" }, take: 10_000 });
  const header = ["Date", "Action", "Acteur", "Utilisateur", "Entreprise", "Objet", "Adresse IP", "Détails"];
  const lines = rows.map(serialize).map((r) => [r.createdAt, r.action, r.actorType, r.user, r.company, r.entity, r.ip, r.metadata].map(csvCell).join(";"));
  return "﻿" + [header.map(csvCell).join(";"), ...lines].join("\r\n") + "\r\n";
}
