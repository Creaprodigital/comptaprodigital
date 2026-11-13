import { authRoute } from "@/server/http/api";
import { setActiveCompany } from "@/server/auth/session-store";
import { assertCanActivateCompany } from "@/server/modules/companies/service";
import { activeCompanySchema } from "@/lib/schemas/company";

/** Change l'entreprise active de la session (après vérification de l'appartenance). */
export const PUT = authRoute({ body: activeCompanySchema }, async ({ auth, body }) => {
  await assertCanActivateCompany(auth.user.id, body.companyId);
  await setActiveCompany(auth.session.id, body.companyId);
  return { activeCompanyId: body.companyId };
});
