import { authRoute } from "@/server/http/api";
import { AppError } from "@/server/http/errors";
import { authorizeCompany } from "@/server/rbac/service";
import { einvoicingAvailable, listIncomingInvoices } from "@/server/modules/einvoicing/service";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  if (!einvoicingAvailable()) throw new AppError(503, "EINVOICING_UNAVAILABLE", "Aucune plateforme de facturation électronique n'est raccordée.");
  return listIncomingInvoices(access);
});
