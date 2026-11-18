import { adminRoute } from "@/server/http/api";
import { integrationsStatus } from "@/server/modules/admin/integrations";

export const GET = adminRoute({}, async () => integrationsStatus());
