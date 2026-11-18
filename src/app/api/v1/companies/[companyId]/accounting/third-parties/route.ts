import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { thirdPartyBalances, thirdPartyLines } from "@/server/modules/accounting/reports";

const querySchema = z.object({ kind: z.enum(["customers", "suppliers"]).default("customers"), account: z.string().max(20).optional(), aux: z.string().max(20).optional() });

/** Balance auxiliaire, ou lignes d'un tiers (compte + compte auxiliaire). */
export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  if (query.account) return thirdPartyLines(access, query.account, query.aux || null);
  return thirdPartyBalances(access, query.kind);
});
