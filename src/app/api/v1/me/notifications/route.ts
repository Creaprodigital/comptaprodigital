import { authRoute } from "@/server/http/api";
import { listNotifications } from "@/server/modules/notifications/service";

export const GET = authRoute({}, async ({ auth }) => listNotifications(auth.user.id));
