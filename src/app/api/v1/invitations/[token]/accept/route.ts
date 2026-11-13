import { authRoute } from "@/server/http/api";
import { setActiveCompany } from "@/server/auth/session-store";
import { acceptInvitation } from "@/server/modules/companies/members";

export const POST = authRoute<{ token: string }>({}, async ({ auth, params, meta }) => {
  const { companyId } = await acceptInvitation(auth, params.token, meta);
  await setActiveCompany(auth.session.id, companyId);
  return { companyId };
});
