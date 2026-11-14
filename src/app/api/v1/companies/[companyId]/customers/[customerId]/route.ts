import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { getCustomer, serializeCustomer, updateCustomer } from "@/server/modules/customers/service";
import { customerSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string; customerId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "customers:read");
  return serializeCustomer(await getCustomer(access, params.customerId));
});

export const PATCH = authRoute<Params, typeof customerSchema>({ body: customerSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "customers:write");
  return serializeCustomer(await updateCustomer(access, auth.user.id, params.customerId, body, meta));
});
