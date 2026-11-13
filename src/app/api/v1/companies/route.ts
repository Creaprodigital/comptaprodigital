import { authRoute, created } from "@/server/http/api";
import { setActiveCompany } from "@/server/auth/session-store";
import { createCompany, listUserCompanies, serializeCompany } from "@/server/modules/companies/service";
import { createCompanySchema } from "@/lib/schemas/company";

export const GET = authRoute({}, async ({ auth }) => listUserCompanies(auth.user.id));

export const POST = authRoute({ body: createCompanySchema }, async ({ auth, body, meta }) => {
  const company = await createCompany(auth.user.id, body, meta);
  await setActiveCompany(auth.session.id, company.id);
  return created(serializeCompany(company));
});
