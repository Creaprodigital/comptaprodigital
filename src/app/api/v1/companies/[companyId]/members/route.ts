import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { listMembers } from "@/server/modules/companies/members";

export const GET = authRoute<{ companyId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:read");
  return listMembers(access.company.id);
});
