import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeCompany, updateCompany } from "@/server/modules/companies/service";
import { updateCompanySchema } from "@/lib/schemas/company";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:read", { allowSuspended: true });
  return { company: serializeCompany(access.company), role: access.roleKey, permissions: [...access.permissions] };
});

export const PATCH = authRoute<Params, typeof updateCompanySchema>({ body: updateCompanySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  return serializeCompany(await updateCompany(access, auth.user.id, body, meta));
});
