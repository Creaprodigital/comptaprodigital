import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { respondToIncoming } from "@/server/modules/einvoicing/service";

type Params = { companyId: string; incomingId: string };
const schema = z.object({ code: z.coerce.number().int(), reason: z.string().trim().max(500).optional() });

/** Statut transmis au fournisseur (prise en charge, approbation, litige, refus…). */
export const POST = authRoute<Params, typeof schema>({ body: schema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return respondToIncoming(access, auth.user.id, params.incomingId, body, meta);
});
