import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { updateSupplier } from "@/server/modules/purchases/service";
import { supplierSchema } from "@/lib/schemas/accounting";

export const PUT = authRoute<{ companyId: string; supplierId: string }, typeof supplierSchema>({ body: supplierSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return updateSupplier(access, auth.user.id, params.supplierId, body, meta);
});
