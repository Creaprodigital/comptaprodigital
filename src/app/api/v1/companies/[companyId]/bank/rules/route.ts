import { authRoute, created } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { createRule, listRules } from "@/server/modules/bank/categories";
import { ruleSchema } from "@/lib/schemas/bank";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listRules(access);
});

export const POST = authRoute<Params, typeof ruleSchema>({ body: ruleSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await createRule(access, auth.user.id, body, meta));
});
