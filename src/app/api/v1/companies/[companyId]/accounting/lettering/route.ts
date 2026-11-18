import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { autoLetter, letterLines, unletter } from "@/server/modules/accounting/reports";
import { letteringSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };
const bodySchema = z.union([letteringSchema, z.object({ auto: z.literal(true) })]);
const deleteSchema = z.object({ account: z.string().trim().max(20), letter: z.string().trim().regex(/^[A-Z]{1,6}$/) });

export const POST = authRoute<Params, typeof bodySchema>({ body: bodySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return "auto" in body ? autoLetter(access, auth.user.id, meta) : letterLines(access, auth.user.id, body.lineIds, meta);
});

export const DELETE = authRoute<Params, undefined, typeof deleteSchema>({ query: deleteSchema }, async ({ auth, params, query, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return unletter(access, auth.user.id, query.account, query.letter, meta);
});
