import { authRoute, noContent } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { deleteDraftEntry, getEntry, updateManualEntry } from "@/server/modules/accounting/entries";
import { manualEntrySchema } from "@/lib/schemas/accounting";

type Params = { companyId: string; entryId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return getEntry(access, params.entryId);
});

export const PUT = authRoute<Params, typeof manualEntrySchema>({ body: manualEntrySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return updateManualEntry(access, auth.user.id, params.entryId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  await deleteDraftEntry(access, auth.user.id, params.entryId, meta);
  return noContent();
});
