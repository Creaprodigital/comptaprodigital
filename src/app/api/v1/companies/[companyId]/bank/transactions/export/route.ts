import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeBank } from "@/server/modules/bank/access";
import { transactionsCsv } from "@/server/modules/bank/transactions";
import { transactionsQuerySchema } from "@/lib/schemas/bank";

export const GET = authRoute<{ companyId: string }, undefined, typeof transactionsQuerySchema>({ query: transactionsQuerySchema, rateLimit: RATE_LIMITS.exports }, async ({ auth, params, query }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return csvResponse("operations-bancaires.csv", await transactionsCsv(access, query));
});
