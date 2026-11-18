import { adminRoute } from "@/server/http/api";
import { extendTrial, getUserAdmin, resyncFromStripe, setPlanManually } from "@/server/modules/admin/users";
import { subscriptionActionSchema } from "@/lib/schemas/admin";

type Params = { userId: string };

export const POST = adminRoute<Params, typeof subscriptionActionSchema>({ body: subscriptionActionSchema }, async ({ auth, params, body, meta }) => {
  if (body.action === "extend_trial") await extendTrial(auth.user.id, params.userId, body.days, body.reason, meta);
  else if (body.action === "set_plan") await setPlanManually(auth.user.id, params.userId, body.planKey, body.reason, meta);
  else await resyncFromStripe(auth.user.id, params.userId, meta);
  return getUserAdmin(params.userId);
});
