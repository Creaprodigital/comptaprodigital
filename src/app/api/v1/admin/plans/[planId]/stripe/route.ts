import { adminRoute } from "@/server/http/api";
import { syncPlanToStripe } from "@/server/modules/admin/plans";

export const POST = adminRoute<{ planId: string }>({}, async ({ auth, params, meta }) => syncPlanToStripe(auth.user.id, params.planId, meta));
