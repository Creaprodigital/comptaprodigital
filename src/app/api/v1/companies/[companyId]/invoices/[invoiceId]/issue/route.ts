import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { issueInvoice, serializeInvoice } from "@/server/modules/invoicing/invoices";

/** Émission : attribue le numéro définitif et verrouille la facture. Opération irréversible. */
export const POST = authRoute<{ companyId: string; invoiceId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  return serializeInvoice(await issueInvoice(access, auth.user.id, params.invoiceId, meta));
});
