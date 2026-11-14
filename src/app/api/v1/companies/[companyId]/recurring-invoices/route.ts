import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createRecurringInvoice, listRecurringInvoices } from "@/server/modules/invoicing/recurring";
import { recurringInvoiceSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  return listRecurringInvoices(access);
});

export const POST = authRoute<Params, typeof recurringInvoiceSchema>({ body: recurringInvoiceSchema }, async ({ auth, params, body, meta }) => {
  // Une récurrence peut émettre des factures : elle exige le droit d'émission.
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  const recurring = await createRecurringInvoice(access, auth.user.id, body, meta);
  return created({ id: recurring.id });
});
