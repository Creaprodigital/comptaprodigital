import { adminRoute } from "@/server/http/api";
import { listAdminPlans } from "@/server/modules/admin/plans";

export const GET = adminRoute({}, async () => listAdminPlans());
