import { authRoute } from "@/server/http/api";
import { AppError } from "@/server/http/errors";
import { authorizeCompany } from "@/server/rbac/service";
import { getInvoiceEInvoicing, submitInvoice } from "@/server/modules/einvoicing/service";

type Params = { companyId: string; invoiceId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  const view = await getInvoiceEInvoicing(access, params.invoiceId);
  if (!view) throw new AppError(503, "EINVOICING_UNAVAILABLE", "Aucune plateforme de facturation électronique n'est raccordée.");
  return view;
});

/** Dépose la facture émise sur la plateforme agréée (à la demande de l'utilisateur). */
export const POST = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  return submitInvoice(access, auth.user.id, params.invoiceId, meta);
});
