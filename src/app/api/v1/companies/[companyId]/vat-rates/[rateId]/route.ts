import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { deleteVatRate } from "@/server/modules/products/service";

export const DELETE = authRoute<{ companyId: string; rateId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  await deleteVatRate(access, auth.user.id, params.rateId, meta);
  return noContent();
});
