import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { applyRulesToUncategorized } from "@/server/modules/bank/transactions";

export const POST = authRoute<{ companyId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return applyRulesToUncategorized(access, auth.user.id, meta);
});
