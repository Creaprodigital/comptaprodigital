import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { accountingOverview } from "@/server/modules/accounting/chart";

export const GET = authRoute<{ companyId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return accountingOverview(access);
});
