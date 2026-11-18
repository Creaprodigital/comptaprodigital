import { authRoute } from "@/server/http/api";
import { openBillingPortal } from "@/server/billing/service";

export const POST = authRoute({}, async ({ auth }) => openBillingPortal(auth.user.id));
