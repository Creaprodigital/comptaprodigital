import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createVatRate, listVatRates } from "@/server/modules/products/service";
import { vatRateSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "products:read");
  return listVatRates(access);
});

export const POST = authRoute<Params, typeof vatRateSchema>({ body: vatRateSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  return created(await createVatRate(access, auth.user.id, body, meta));
});
