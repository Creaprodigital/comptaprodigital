import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { reconcileTransaction, suggestReconciliation, unreconcileTransaction } from "@/server/modules/bank/reconciliation";
import { getTransaction } from "@/server/modules/bank/transactions";
import { reconcileSchema } from "@/lib/schemas/bank";

type Params = { companyId: string; transactionId: string };

/** Factures ouvertes et règlements non rapprochés pouvant correspondre à l'encaissement. */
export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return suggestReconciliation(access, await getTransaction(access, params.transactionId));
});

export const POST = authRoute<Params, typeof reconcileSchema>({ body: reconcileSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return reconcileTransaction(access, auth.user.id, params.transactionId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return unreconcileTransaction(access, auth.user.id, params.transactionId, meta);
});
