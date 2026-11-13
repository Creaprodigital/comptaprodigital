import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { inviteMember } from "@/server/modules/companies/members";
import { inviteMemberSchema } from "@/lib/schemas/company";

export const POST = authRoute<{ companyId: string }, typeof inviteMemberSchema>(
  { body: inviteMemberSchema, rateLimit: RATE_LIMITS.invitations },
  async ({ auth, params, body, meta }) => {
    const access = await authorizeCompany(auth.user.id, params.companyId, "members:manage");
    return created(await inviteMember(access, auth.user, body, meta));
  },
);
