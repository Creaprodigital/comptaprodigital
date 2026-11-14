import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeCustomer, setCustomerArchived } from "@/server/modules/customers/service";

const schema = z.object({ archived: z.boolean() });

export const POST = authRoute<{ companyId: string; customerId: string }, typeof schema>({ body: schema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "customers:write");
  return serializeCustomer(await setCustomerArchived(access, auth.user.id, params.customerId, body.archived, meta));
});
