import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { setBankAccountActive } from "@/server/modules/bank/accounts";

const bodySchema = z.object({ archived: z.boolean() });

export const POST = authRoute<{ companyId: string; accountId: string }, typeof bodySchema>({ body: bodySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return setBankAccountActive(access, auth.user.id, params.accountId, !body.archived, meta);
});
