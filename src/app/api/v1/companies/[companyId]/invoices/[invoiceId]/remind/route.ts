import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { sendReminder } from "@/server/modules/invoicing/sending";

export const POST = authRoute<{ companyId: string; invoiceId: string }>({ rateLimit: RATE_LIMITS.documentEmail }, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:write");
  return sendReminder(access, auth.user, params.invoiceId, meta);
});
