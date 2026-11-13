import { publicRoute } from "@/server/http/api";
import { listActivePlans } from "@/server/modules/plans/service";

export const GET = publicRoute({}, async () => listActivePlans());
