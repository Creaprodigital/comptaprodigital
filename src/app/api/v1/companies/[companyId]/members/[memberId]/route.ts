import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { removeMember, updateMemberRole } from "@/server/modules/companies/members";
import { updateMemberSchema } from "@/lib/schemas/company";

type Params = { companyId: string; memberId: string };

export const PATCH = authRoute<Params, typeof updateMemberSchema>({ body: updateMemberSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:manage");
  await updateMemberRole(access, auth.user.id, params.memberId, body.role, meta);
  return { updated: true };
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:manage");
  await removeMember(access, auth.user.id, params.memberId, meta);
  return noContent();
});
