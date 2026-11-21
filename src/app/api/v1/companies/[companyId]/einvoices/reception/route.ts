import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { setEInvoicingReception } from "@/server/modules/einvoicing/service";

type Params = { companyId: string };
const schema = z.object({ active: z.boolean() });

/** Active la réception des factures électroniques de l'entreprise par la plateforme de ComptaPro Digital. */
export const PUT = authRoute<Params, typeof schema>({ body: schema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  return setEInvoicingReception(access, auth.user.id, body.active, meta);
});
