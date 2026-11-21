import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { declareCollected } from "@/server/modules/einvoicing/service";

type Params = { companyId: string; invoiceId: string };

/** Déclare l'encaissement de la facture (statut 212) : action explicite de l'utilisateur. */
export const POST = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  return declareCollected(access, auth.user.id, params.invoiceId, meta);
});
