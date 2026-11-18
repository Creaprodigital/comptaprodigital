import { adminRoute } from "@/server/http/api";
import { getError } from "@/server/modules/admin/errors";

export const GET = adminRoute<{ errorId: string }>({}, async ({ params }) => getError(params.errorId));
