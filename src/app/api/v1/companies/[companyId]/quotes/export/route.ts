import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { quotesCsv } from "@/server/modules/invoicing/quotes";

export const GET = authRoute<{ companyId: string }>({ rateLimit: RATE_LIMITS.exports }, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:read");
  return csvResponse("devis.csv", await quotesCsv(access));
});
