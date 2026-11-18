import { authRoute } from "@/server/http/api";
import { changePlan } from "@/server/billing/service";
import { checkoutSchema } from "@/lib/schemas/billing";

export const POST = authRoute<Record<string, never>, typeof checkoutSchema>({ body: checkoutSchema }, async ({ auth, body, meta }) => {
  await changePlan(auth.user.id, body.plan, body.interval, meta);
  return { changed: true };
});
