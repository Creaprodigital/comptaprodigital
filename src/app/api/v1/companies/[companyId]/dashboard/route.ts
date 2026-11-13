import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { getDashboard } from "@/server/modules/dashboard/service";

const querySchema = z.object({
  period: z.string().max(10).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "dashboard:read");
  return getDashboard(access.company, { preset: query.period, from: query.from, to: query.to });
});
