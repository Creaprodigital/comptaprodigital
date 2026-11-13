import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { revokeInvitation } from "@/server/modules/companies/members";

export const DELETE = authRoute<{ companyId: string; invitationId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:manage");
  await revokeInvitation(access, auth.user.id, params.invitationId, meta);
  return noContent();
});
