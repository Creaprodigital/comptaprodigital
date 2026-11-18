import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createPurchase, listPurchases } from "@/server/modules/purchases/service";
import { purchaseSchema, purchasesQuerySchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof purchasesQuerySchema>({ query: purchasesQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  return listPurchases(access, query);
});

export const POST = authRoute<Params, typeof purchaseSchema>({ body: purchaseSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return created(await createPurchase(access, auth.user.id, body, meta));
});
