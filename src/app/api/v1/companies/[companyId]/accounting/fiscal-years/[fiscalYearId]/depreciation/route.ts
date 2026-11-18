import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { pendingDepreciations, postDepreciations } from "@/server/modules/accounting/assets";

type Params = { companyId: string; fiscalYearId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return pendingDepreciations(access, params.fiscalYearId);
});

export const POST = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return postDepreciations(access, auth.user.id, params.fiscalYearId, meta);
});
