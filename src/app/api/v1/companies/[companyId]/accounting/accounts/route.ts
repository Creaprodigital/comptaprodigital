import { z } from "zod";
import { authRoute, created } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { createAccount, listAccounts } from "@/server/modules/accounting/chart";
import { accountSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };
const querySchema = z.object({ q: z.string().trim().max(60).optional(), used: z.enum(["true", "false"]).optional() });

export const GET = authRoute<Params, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return listAccounts(access, { q: query.q, used: query.used === "true" });
});

export const POST = authRoute<Params, typeof accountSchema>({ body: accountSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return created(await createAccount(access, auth.user.id, body, meta));
});
