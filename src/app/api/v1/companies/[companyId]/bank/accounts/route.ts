import { z } from "zod";
import { authRoute, created } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { createBankAccount, listBankAccounts } from "@/server/modules/bank/accounts";
import { bankAccountSchema } from "@/lib/schemas/bank";

type Params = { companyId: string };
const querySchema = z.object({ all: z.enum(["true", "false"]).optional() });

export const GET = authRoute<Params, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listBankAccounts(access, { includeInactive: query.all === "true" });
});

export const POST = authRoute<Params, typeof bankAccountSchema>({ body: bankAccountSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await createBankAccount(access, auth.user.id, body, meta));
});
