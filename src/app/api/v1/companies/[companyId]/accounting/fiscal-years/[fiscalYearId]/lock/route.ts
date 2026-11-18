import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { lockPeriod } from "@/server/modules/accounting/closing";
import { lockPeriodSchema } from "@/lib/schemas/accounting";

export const POST = authRoute<{ companyId: string; fiscalYearId: string }, typeof lockPeriodSchema>({ body: lockPeriodSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:close");
  return lockPeriod(access, auth.user.id, params.fiscalYearId, body.through, meta);
});
