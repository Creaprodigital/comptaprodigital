import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createInvoiceDraft, listInvoices, serializeInvoice } from "@/server/modules/invoicing/invoices";
import { invoiceSchema, listQuerySchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof listQuerySchema>({ query: listQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  return listInvoices(access, { q: query.q, filter: query.status, page: query.page, pageSize: query.pageSize });
});

export const POST = authRoute<Params, typeof invoiceSchema>({ body: invoiceSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:write");
  return created(serializeInvoice(await createInvoiceDraft(access, auth.user.id, body, meta)));
});
