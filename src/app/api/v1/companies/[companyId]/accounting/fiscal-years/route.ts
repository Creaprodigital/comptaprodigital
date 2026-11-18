import { authRoute, created } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { createNextFiscalYear, listFiscalYears } from "@/server/modules/accounting/closing";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return listFiscalYears(access);
});

export const POST = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:close");
  return created(await createNextFiscalYear(access, auth.user.id, meta));
});
