import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { listGrants } from "@/server/modules/admin/access-grants";

/** Accès du support aux données de l'entreprise : visibles par les membres habilités. */
export const GET = authRoute<{ companyId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:read");
  return listGrants(access.company.id);
});
