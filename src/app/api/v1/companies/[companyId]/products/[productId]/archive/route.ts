import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeProduct, setProductActive } from "@/server/modules/products/service";

const schema = z.object({ archived: z.boolean() });

export const POST = authRoute<{ companyId: string; productId: string }, typeof schema>({ body: schema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "products:write");
  return serializeProduct(await setProductActive(access, auth.user.id, params.productId, !body.archived, meta));
});
