import { adminRoute } from "@/server/http/api";
import { updatePlan } from "@/server/modules/admin/plans";
import { planUpdateSchema } from "@/lib/schemas/admin";

export const PUT = adminRoute<{ planId: string }, typeof planUpdateSchema>({ body: planUpdateSchema }, async ({ auth, params, body, meta }) => updatePlan(auth.user.id, params.planId, body, meta));
