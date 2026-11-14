import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeInvoice } from "@/server/modules/invoicing/invoices";
import { convertQuote } from "@/server/modules/invoicing/quotes";
import { convertQuoteSchema } from "@/lib/schemas/invoicing";

/** Transforme un devis en facture (ou en facture d'acompte) : la facture est créée en brouillon. */
export const POST = authRoute<{ companyId: string; quoteId: string }, typeof convertQuoteSchema>({ body: convertQuoteSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:write");
  return created(serializeInvoice(await convertQuote(access, auth.user.id, params.quoteId, body, meta)));
});
