import { authRoute, created } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { createManualEntry, listEntries } from "@/server/modules/accounting/entries";
import { entriesQuerySchema, manualEntrySchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof entriesQuerySchema>({ query: entriesQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return listEntries(access, query);
});

export const POST = authRoute<Params, typeof manualEntrySchema>({ body: manualEntrySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return created(await createManualEntry(access, auth.user.id, body, meta));
});
