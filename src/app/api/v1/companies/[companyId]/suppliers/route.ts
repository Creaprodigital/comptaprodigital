import { z } from "zod";
import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createSupplier, listSuppliers } from "@/server/modules/purchases/service";
import { supplierSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };
const querySchema = z.object({ q: z.string().trim().max(100).optional(), archived: z.enum(["true", "false"]).optional() });

export const GET = authRoute<Params, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  return listSuppliers(access, { q: query.q, archived: query.archived === "true" });
});

export const POST = authRoute<Params, typeof supplierSchema>({ body: supplierSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  return created(await createSupplier(access, auth.user.id, body, meta));
});
