import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";

/** Erreurs applicatives inattendues (500), consignées sans donnée sensible. */

export async function listErrors(filter: { q?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where = filter.q ? { OR: [{ message: { contains: filter.q } }, { path: { contains: filter.q } }] } : {};
  const [rows, total, byPath] = await Promise.all([
    prisma.applicationError.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, select: { id: true, message: true, path: true, method: true, createdAt: true } }),
    prisma.applicationError.count({ where }),
    prisma.applicationError.groupBy({ by: ["path"], where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, _count: { _all: true }, orderBy: { _count: { path: "desc" } }, take: 5 }),
  ]);
  return {
    items: rows.map((r) => ({ ...r, message: r.message.slice(0, 300), createdAt: r.createdAt.toISOString() })),
    total,
    page,
    pageSize: 50,
    topPaths7d: byPath.map((p) => ({ path: p.path ?? "—", count: p._count._all })),
  };
}

export async function getError(id: string) {
  const row = await prisma.applicationError.findUnique({ where: { id } });
  if (!row) throw errors.notFound("Erreur introuvable.");
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Purge les erreurs de plus de `days` jours (30 par défaut). */
export async function purgeErrors(adminId: string, days = 30) {
  const { count } = await prisma.applicationError.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400_000) } } });
  await recordAudit({ action: "admin.errors_purged", userId: adminId, actorType: "SUPER_ADMIN", metadata: { days, count } });
  return { deleted: count };
}
