import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeProduct, updateProduct } from "@/server/modules/products/service";
import { productSchema } from "@/lib/schemas/invoicing";

export const PATCH = authRoute<{ companyId: string; productId: string }, typeof productSchema>({ body: productSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "products:write");
  return serializeProduct(await updateProduct(access, auth.user.id, params.productId, body, meta));
});
