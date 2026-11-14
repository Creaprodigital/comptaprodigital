import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createCustomer, listCustomers, serializeCustomer } from "@/server/modules/customers/service";
import { customerSchema, listQuerySchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof listQuerySchema>({ query: listQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "customers:read");
  return listCustomers(access, { q: query.q, page: query.page, pageSize: query.pageSize, archived: query.archived === "true" });
});

export const POST = authRoute<Params, typeof customerSchema>({ body: customerSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "customers:write");
  return created(serializeCustomer(await createCustomer(access, auth.user.id, body, meta)));
});
