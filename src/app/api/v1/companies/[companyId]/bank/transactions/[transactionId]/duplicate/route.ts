import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { dismissDuplicate } from "@/server/modules/bank/transactions";

/** Lève le signalement de doublon : l'opération est confirmée comme légitime. */
export const DELETE = authRoute<{ companyId: string; transactionId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return dismissDuplicate(access, auth.user.id, params.transactionId, meta);
});
