import { authRoute, noContent } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { disconnectBankConnection } from "@/server/modules/bank/connections";

type Params = { companyId: string; connectionId: string };

/** Révoque le consentement chez Bridge ; les comptes et leurs opérations sont conservés. */
export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await disconnectBankConnection(access, auth.user.id, params.connectionId, meta);
  return noContent();
});
