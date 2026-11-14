import { authRoute, created } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { createManualTransaction, listTransactions } from "@/server/modules/bank/transactions";
import { manualTransactionSchema, transactionsQuerySchema } from "@/lib/schemas/bank";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof transactionsQuerySchema>({ query: transactionsQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listTransactions(access, query);
});

export const POST = authRoute<Params, typeof manualTransactionSchema>({ body: manualTransactionSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await createManualTransaction(access, auth.user.id, body, meta));
});
