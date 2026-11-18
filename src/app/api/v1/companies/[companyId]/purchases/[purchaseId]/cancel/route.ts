import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { cancelPurchase } from "@/server/modules/purchases/service";

export const POST = authRoute<{ companyId: string; purchaseId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return cancelPurchase(access, auth.user.id, params.purchaseId, meta);
});
