import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { bankReconciliation } from "@/server/modules/accounting/reports";
import { isoDate } from "@/lib/schemas/invoicing";
import { todayInParis } from "@/lib/dates";

const querySchema = z.object({ bankAccountId: z.string().min(1).max(40), date: isoDate.optional() });

export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return bankReconciliation(access, query.bankAccountId, query.date ?? todayInParis());
});
