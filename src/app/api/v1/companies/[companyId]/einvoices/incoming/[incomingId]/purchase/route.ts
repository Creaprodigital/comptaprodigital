import { z } from "zod";
import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createPurchaseFromIncoming } from "@/server/modules/einvoicing/service";

type Params = { companyId: string; incomingId: string };
const schema = z.object({ categoryId: z.string().min(1, "Choisissez une catégorie").max(40) });

export const POST = authRoute<Params, typeof schema>({ body: schema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return created(await createPurchaseFromIncoming(access, auth.user.id, params.incomingId, body, meta));
});
