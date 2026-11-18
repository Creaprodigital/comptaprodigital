import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { getPurchase, getPurchaseHistory, updatePurchase } from "@/server/modules/purchases/service";
import { purchaseSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string; purchaseId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  const [purchase, history] = await Promise.all([getPurchase(access, params.purchaseId), getPurchaseHistory(access, params.purchaseId)]);
  return { purchase, history };
});

export const PUT = authRoute<Params, typeof purchaseSchema>({ body: purchaseSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return updatePurchase(access, auth.user.id, params.purchaseId, body, meta);
});
