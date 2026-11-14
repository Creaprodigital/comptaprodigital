import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { deletePayment, serializeInvoice } from "@/server/modules/invoicing/invoices";

export const DELETE = authRoute<{ companyId: string; invoiceId: string; paymentId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "payments:write");
  return serializeInvoice(await deletePayment(access, auth.user.id, params.invoiceId, params.paymentId, meta));
});
