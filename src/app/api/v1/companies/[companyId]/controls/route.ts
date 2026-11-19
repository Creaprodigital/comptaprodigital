import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { runControls } from "@/server/modules/controls/service";

export const GET = authRoute<{ companyId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:read");
  return runControls(access);
});
