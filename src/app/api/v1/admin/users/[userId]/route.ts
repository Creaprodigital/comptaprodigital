import { adminRoute } from "@/server/http/api";
import { getUserAdmin, setUserSuspended } from "@/server/modules/admin/users";
import { suspendSchema } from "@/lib/schemas/admin";

type Params = { userId: string };

export const GET = adminRoute<Params>({}, async ({ params }) => getUserAdmin(params.userId));

/** Suspension ou réactivation d'un compte (motif obligatoire pour suspendre). */
export const POST = adminRoute<Params, typeof suspendSchema>({ body: suspendSchema }, async ({ auth, params, body, meta }) => {
  await setUserSuspended(auth.user.id, params.userId, body.suspended, body.reason ?? null, meta);
  return getUserAdmin(params.userId);
});
