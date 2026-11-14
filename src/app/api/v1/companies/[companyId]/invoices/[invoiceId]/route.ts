import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { deleteInvoiceDraft, getInvoiceDetail, getInvoiceHistory, serializeInvoice, updateInvoiceDraft } from "@/server/modules/invoicing/invoices";
import { invoiceSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string; invoiceId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  const [invoice, history] = await Promise.all([getInvoiceDetail(access, params.invoiceId), getInvoiceHistory(access, params.invoiceId)]);
  return { invoice: serializeInvoice(invoice), history };
});

/** Modification d'un brouillon. Une facture émise est verrouillée (409). */
export const PATCH = authRoute<Params, typeof invoiceSchema>({ body: invoiceSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:write");
  return serializeInvoice(await updateInvoiceDraft(access, auth.user.id, params.invoiceId, body, meta));
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:write");
  await deleteInvoiceDraft(access, auth.user.id, params.invoiceId, meta);
  return noContent();
});
