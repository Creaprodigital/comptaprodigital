import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { journalCsv } from "@/server/modules/accounting/reports";
import { reportQuerySchema } from "@/lib/schemas/accounting";

export const GET = authRoute<{ companyId: string }, undefined, typeof reportQuerySchema>({ query: reportQuerySchema, rateLimit: RATE_LIMITS.exports }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "exports:run");
  return csvResponse("journaux.csv", await journalCsv(access, { fiscalYearId: query.fiscalYearId, from: query.from, to: query.to, journalId: query.journalId, includeDrafts: query.drafts !== "exclude" }));
});
