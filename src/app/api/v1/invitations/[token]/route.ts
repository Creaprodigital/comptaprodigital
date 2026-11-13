import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { getInvitationPreview } from "@/server/modules/companies/members";

export const GET = publicRoute<{ token: string }>({ rateLimit: RATE_LIMITS.companySearch }, async ({ params }) =>
  getInvitationPreview(params.token),
);
