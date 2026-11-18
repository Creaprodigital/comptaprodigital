import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { purchasesCsv } from "@/server/modules/purchases/service";

export const GET = authRoute<{ companyId: string }>({ rateLimit: RATE_LIMITS.exports }, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  return csvResponse("achats.csv", await purchasesCsv(access));
});
