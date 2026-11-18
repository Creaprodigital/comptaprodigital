import { authRoute } from "@/server/http/api";
import { setCancelAtPeriodEnd } from "@/server/billing/service";
import { cancelSchema } from "@/lib/schemas/billing";

/** Résiliation en fin de période (cancel: true) ou reprise de l'abonnement (cancel: false). */
export const POST = authRoute<Record<string, never>, typeof cancelSchema>({ body: cancelSchema }, async ({ auth, body, meta }) => {
  await setCancelAtPeriodEnd(auth.user.id, body.cancel, meta);
  return { cancelAtPeriodEnd: body.cancel };
});
