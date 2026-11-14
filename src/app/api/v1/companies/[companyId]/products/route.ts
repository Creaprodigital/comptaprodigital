import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createProduct, listProducts, serializeProduct } from "@/server/modules/products/service";
import { listQuerySchema, productSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof listQuerySchema>({ query: listQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "products:read");
  return listProducts(access, { q: query.q, page: query.page, pageSize: query.pageSize, archived: query.archived === "true" });
});

export const POST = authRoute<Params, typeof productSchema>({ body: productSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "products:write");
  return created(serializeProduct(await createProduct(access, auth.user.id, body, meta)));
});
