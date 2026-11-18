import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { RATE_LIMITS, enforceRateLimit } from "@/server/security/rate-limit";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { trialBalance, trialBalanceCsv } from "@/server/modules/accounting/reports";
import { reportQuerySchema } from "@/lib/schemas/accounting";

const querySchema = reportQuerySchema.extend({ format: z.enum(["json", "csv"]).optional() });

export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query, meta }) => {
  const filter = { fiscalYearId: query.fiscalYearId, from: query.from, to: query.to, account: query.account, journalId: query.journalId, includeDrafts: query.drafts !== "exclude" };
  if (query.format === "csv") {
    const access = await authorizeAccounting(auth.user.id, params.companyId, "exports:run");
    await enforceRateLimit(RATE_LIMITS.exports, meta.ip);
    return csvResponse("balance-generale.csv", await trialBalanceCsv(access, filter));
  }
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return trialBalance(access, filter);
});
