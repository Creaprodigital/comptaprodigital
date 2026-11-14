import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { recordPayment, serializeInvoice } from "@/server/modules/invoicing/invoices";
import { paymentSchema } from "@/lib/schemas/invoicing";

export const POST = authRoute<{ companyId: string; invoiceId: string }, typeof paymentSchema>({ body: paymentSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "payments:write");
  return created(serializeInvoice(await recordPayment(access, auth.user.id, params.invoiceId, body, meta)));
});
