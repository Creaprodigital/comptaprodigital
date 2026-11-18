import { authRoute, created } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { reverseEntry } from "@/server/modules/accounting/entries";
import { reverseEntrySchema } from "@/lib/schemas/accounting";

export const POST = authRoute<{ companyId: string; entryId: string }, typeof reverseEntrySchema>({ body: reverseEntrySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return created(await reverseEntry(access, auth.user.id, params.entryId, { date: body.date }, meta));
});
