import { adminRoute } from "@/server/http/api";
import { getCompanyAdmin, setCompanyStatus } from "@/server/modules/admin/companies";
import { companyStatusSchema } from "@/lib/schemas/admin";

type Params = { companyId: string };

export const GET = adminRoute<Params>({}, async ({ params }) => getCompanyAdmin(params.companyId));

export const POST = adminRoute<Params, typeof companyStatusSchema>({ body: companyStatusSchema }, async ({ auth, params, body, meta }) => {
  await setCompanyStatus(auth.user.id, params.companyId, body.status, body.reason ?? null, meta);
  return getCompanyAdmin(params.companyId);
});
