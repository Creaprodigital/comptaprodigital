import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { closeFiscalYear, closingCheck } from "@/server/modules/accounting/closing";

type Params = { companyId: string; fiscalYearId: string };

/** Contrôles préalables à la clôture. */
export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return closingCheck(access, params.fiscalYearId);
});

/** Clôture définitive. */
export const POST = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:close");
  return closeFiscalYear(access, auth.user.id, params.fiscalYearId, meta);
});
