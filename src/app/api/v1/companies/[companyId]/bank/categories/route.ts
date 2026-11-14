import { authRoute, created } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { createCategory, listCategories } from "@/server/modules/bank/categories";
import { categorySchema } from "@/lib/schemas/bank";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listCategories(access.company.id);
});

export const POST = authRoute<Params, typeof categorySchema>({ body: categorySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await createCategory(access, auth.user.id, body, meta));
});
