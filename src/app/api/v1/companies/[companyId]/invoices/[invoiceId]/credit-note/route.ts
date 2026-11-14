import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createCreditNote, serializeInvoice } from "@/server/modules/invoicing/invoices";
import { creditNoteSchema } from "@/lib/schemas/invoicing";

/** Prépare un avoir (brouillon) sur une facture émise ; il sera numéroté à son émission. */
export const POST = authRoute<{ companyId: string; invoiceId: string }, typeof creditNoteSchema>({ body: creditNoteSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  return created(serializeInvoice(await createCreditNote(access, auth.user.id, params.invoiceId, body, meta)));
});
