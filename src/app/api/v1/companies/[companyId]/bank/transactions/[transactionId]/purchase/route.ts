import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { authorizeBank } from "@/server/modules/bank/access";
import { getTransaction } from "@/server/modules/bank/transactions";
import { linkPurchasePayment, suggestPurchases, unlinkPurchasePayment } from "@/server/modules/purchases/service";
import { purchaseLinkSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string; transactionId: string };

/** Factures d'achat à régler pouvant correspondre à ce décaissement. */
export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  return suggestPurchases(access, await getTransaction(access, params.transactionId));
});

export const POST = authRoute<Params, typeof purchaseLinkSchema>({ body: purchaseLinkSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  await linkPurchasePayment(access, auth.user.id, params.transactionId, body.purchaseId, meta);
  return getTransaction(access, params.transactionId);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await authorizeCompany(auth.user.id, params.companyId, "purchases:write");
  await unlinkPurchasePayment(access, auth.user.id, params.transactionId, meta);
  return getTransaction(access, params.transactionId);
});
