import { authRoute, noContent } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { deleteTransaction, getTransactionDetail, updateTransaction } from "@/server/modules/bank/transactions";
import { transactionUpdateSchema } from "@/lib/schemas/bank";

type Params = { companyId: string; transactionId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return getTransactionDetail(access, params.transactionId);
});

export const PATCH = authRoute<Params, typeof transactionUpdateSchema>({ body: transactionUpdateSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return updateTransaction(access, auth.user.id, params.transactionId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await deleteTransaction(access, auth.user.id, params.transactionId, meta);
  return noContent();
});
