import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { setSupplierArchived } from "@/server/modules/purchases/service";

const bodySchema = z.object({ archived: z.boolean() });

export const POST = authRoute<{ companyId: string; supplierId: string }, typeof bodySchema>({ body: bodySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return setSupplierArchived(access, auth.user.id, params.supplierId, body.archived, meta);
});
