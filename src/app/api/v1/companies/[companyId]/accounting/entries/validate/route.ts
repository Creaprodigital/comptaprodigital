import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { validateDraftsThrough, validateEntries } from "@/server/modules/accounting/entries";
import { validateEntriesSchema } from "@/lib/schemas/accounting";

/** Validation d'écritures du brouillard : une sélection, ou tout le brouillard jusqu'à une date. */
export const POST = authRoute<{ companyId: string }, typeof validateEntriesSchema>({ body: validateEntriesSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return "ids" in body ? validateEntries(access, auth.user.id, body.ids, meta) : validateDraftsThrough(access, auth.user.id, { through: body.through, journalId: body.journalId }, meta);
});
