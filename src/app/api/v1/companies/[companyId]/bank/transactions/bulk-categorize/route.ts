import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { bulkCategorize } from "@/server/modules/bank/transactions";
import { bulkCategorizeSchema } from "@/lib/schemas/bank";

export const POST = authRoute<{ companyId: string }, typeof bulkCategorizeSchema>({ body: bulkCategorizeSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return bulkCategorize(access, auth.user.id, body, meta);
});
