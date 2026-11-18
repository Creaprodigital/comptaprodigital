import { adminRoute, created } from "@/server/http/api";
import { listAnnouncements, saveAnnouncement } from "@/server/modules/admin/announcements";
import { announcementSchema } from "@/lib/schemas/admin";

export const GET = adminRoute({}, async () => listAnnouncements());

export const POST = adminRoute<Record<string, never>, typeof announcementSchema>({ body: announcementSchema }, async ({ auth, body }) =>
  created(await saveAnnouncement(auth.user.id, null, { ...body, startsAt: body.startsAt ?? new Date() })),
);
