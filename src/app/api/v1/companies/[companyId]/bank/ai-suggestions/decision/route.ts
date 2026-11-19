import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { decideSuggestions } from "@/server/ai/categorization";
import { suggestionDecisionSchema } from "@/lib/schemas/ai";

export const POST = authRoute<{ companyId: string }, typeof suggestionDecisionSchema>({ body: suggestionDecisionSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return decideSuggestions(access, auth.user.id, body, meta);
});
