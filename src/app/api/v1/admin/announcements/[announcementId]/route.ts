import { adminRoute, noContent } from "@/server/http/api";
import { deleteAnnouncement, saveAnnouncement } from "@/server/modules/admin/announcements";
import { announcementSchema } from "@/lib/schemas/admin";

type Params = { announcementId: string };

export const PUT = adminRoute<Params, typeof announcementSchema>({ body: announcementSchema }, async ({ auth, params, body }) =>
  saveAnnouncement(auth.user.id, params.announcementId, { ...body, startsAt: body.startsAt ?? new Date() }),
);

export const DELETE = adminRoute<Params>({}, async ({ auth, params }) => {
  await deleteAnnouncement(auth.user.id, params.announcementId);
  return noContent();
});
