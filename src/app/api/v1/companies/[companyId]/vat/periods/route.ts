import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeVat } from "@/server/modules/accounting/access";
import { listVatPeriods } from "@/server/modules/vat/service";

const querySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeVat(auth.user.id, params.companyId, "vat:read");
  return listVatPeriods(access, query.year);
});
