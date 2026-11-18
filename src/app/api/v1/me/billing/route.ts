import { authRoute } from "@/server/http/api";
import { getBillingOverview } from "@/server/billing/service";

export const GET = authRoute({}, async ({ auth }) => getBillingOverview(auth.user.id));
