import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { markNotificationsRead } from "@/server/modules/notifications/service";

const schema = z.object({ ids: z.array(z.string().max(40)).max(100).optional() });

/** Marque comme lues les notifications indiquées, ou toutes si aucune liste n'est fournie. */
export const POST = authRoute({ body: schema }, async ({ auth, body }) => ({
  updated: await markNotificationsRead(auth.user.id, body.ids),
}));
