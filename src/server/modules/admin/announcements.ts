import type { AnnouncementLevel } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";

/** Annonces système affichées en bandeau dans l'espace client (maintenance, nouveauté, incident). */

export type AnnouncementView = { id: string; title: string; body: string; level: AnnouncementLevel; startsAt: string; endsAt: string | null; isActive: boolean; live: boolean };

function serialize(row: { id: string; title: string; body: string; level: AnnouncementLevel; startsAt: Date; endsAt: Date | null; isActive: boolean }, now = new Date()): AnnouncementView {
  return { id: row.id, title: row.title, body: row.body, level: row.level, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null, isActive: row.isActive, live: row.isActive && row.startsAt <= now && (!row.endsAt || row.endsAt > now) };
}

export async function liveAnnouncements(): Promise<AnnouncementView[]> {
  const now = new Date();
  const rows = await prisma.systemAnnouncement.findMany({ where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: [{ level: "desc" }, { startsAt: "desc" }], take: 3 });
  return rows.map((r) => serialize(r, now));
}

export async function listAnnouncements(): Promise<AnnouncementView[]> {
  return (await prisma.systemAnnouncement.findMany({ orderBy: { startsAt: "desc" }, take: 100 })).map((r) => serialize(r));
}

type Input = { title: string; body: string; level: AnnouncementLevel; startsAt: Date; endsAt: Date | null; isActive: boolean };

export async function saveAnnouncement(adminId: string, id: string | null, input: Input): Promise<AnnouncementView> {
  if (input.endsAt && input.endsAt <= input.startsAt) throw errors.validation([{ path: "endsAt", message: "La fin doit suivre le début" }]);
  const row = id ? await prisma.systemAnnouncement.update({ where: { id }, data: input }).catch(() => null) : await prisma.systemAnnouncement.create({ data: input });
  if (!row) throw errors.notFound("Annonce introuvable.");
  await recordAudit({ action: id ? "admin.announcement_update" : "admin.announcement_create", userId: adminId, actorType: "SUPER_ADMIN", entityType: "SystemAnnouncement", entityId: row.id, metadata: { title: input.title } });
  return serialize(row);
}

export async function deleteAnnouncement(adminId: string, id: string): Promise<void> {
  const result = await prisma.systemAnnouncement.deleteMany({ where: { id } });
  if (!result.count) throw errors.notFound("Annonce introuvable.");
  await recordAudit({ action: "admin.announcement_delete", userId: adminId, actorType: "SUPER_ADMIN", entityType: "SystemAnnouncement", entityId: id });
}
