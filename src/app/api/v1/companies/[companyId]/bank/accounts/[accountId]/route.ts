import { authRoute, noContent } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { deleteBankAccount, updateBankAccount } from "@/server/modules/bank/accounts";
import { bankAccountSchema } from "@/lib/schemas/bank";

type Params = { companyId: string; accountId: string };

export const PUT = authRoute<Params, typeof bankAccountSchema>({ body: bankAccountSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return updateBankAccount(access, auth.user.id, params.accountId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await deleteBankAccount(access, auth.user.id, params.accountId, meta);
  return noContent();
});
