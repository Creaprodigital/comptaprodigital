import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { deleteCategory, updateCategory } from "@/server/modules/bank/categories";
import { categorySchema } from "@/lib/schemas/bank";

type Params = { companyId: string; categoryId: string };

export const PUT = authRoute<Params, typeof categorySchema>({ body: categorySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return updateCategory(access, auth.user.id, params.categoryId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return deleteCategory(access, auth.user.id, params.categoryId, meta);
});
