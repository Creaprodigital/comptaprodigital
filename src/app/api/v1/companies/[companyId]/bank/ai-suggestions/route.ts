import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { listCategorySuggestions, suggestCategories } from "@/server/ai/categorization";
import { suggestRequestSchema } from "@/lib/schemas/ai";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listCategorySuggestions(access);
});

/** Demande à l'IA des suggestions de catégorie (enregistrées en attente de décision). */
export const POST = authRoute<Params, typeof suggestRequestSchema>({ body: suggestRequestSchema, rateLimit: RATE_LIMITS.ai }, async ({ auth, params, body }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return suggestCategories(access, auth.user.id, body);
});
