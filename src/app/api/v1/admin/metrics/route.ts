import { adminRoute } from "@/server/http/api";
import { saasMetrics } from "@/server/modules/admin/metrics";

export const GET = adminRoute({}, async () => saasMetrics());
