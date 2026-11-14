import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { invoicesCsv } from "@/server/modules/invoicing/invoices";

export const GET = authRoute<{ companyId: string }>({ rateLimit: RATE_LIMITS.exports }, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  return csvResponse("factures.csv", await invoicesCsv(access));
});
