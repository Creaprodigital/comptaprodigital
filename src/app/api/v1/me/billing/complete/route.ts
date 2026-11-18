import { authRoute } from "@/server/http/api";
import { completeCheckout } from "@/server/billing/service";
import { completeCheckoutSchema } from "@/lib/schemas/billing";

export const POST = authRoute<Record<string, never>, typeof completeCheckoutSchema>({ body: completeCheckoutSchema }, async ({ auth, body }) => {
  await completeCheckout(auth.user.id, body.sessionId);
  return { synced: true };
});
