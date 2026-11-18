import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { updateAccount } from "@/server/modules/accounting/chart";
import { accountUpdateSchema } from "@/lib/schemas/accounting";

export const PATCH = authRoute<{ companyId: string; accountId: string }, typeof accountUpdateSchema>({ body: accountUpdateSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return updateAccount(access, auth.user.id, params.accountId, body, meta);
});
