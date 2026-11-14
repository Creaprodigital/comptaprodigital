import { authRoute, noContent } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { deleteRule, updateRule } from "@/server/modules/bank/categories";
import { ruleSchema } from "@/lib/schemas/bank";

type Params = { companyId: string; ruleId: string };

export const PUT = authRoute<Params, typeof ruleSchema>({ body: ruleSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return updateRule(access, auth.user.id, params.ruleId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await deleteRule(access, auth.user.id, params.ruleId, meta);
  return noContent();
});
