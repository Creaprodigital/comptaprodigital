import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { askAssistant } from "@/server/ai/assistant";
import { assistantSchema } from "@/lib/schemas/ai";

/** Question à l'assistant. La conversation est tenue par le navigateur et n'est pas conservée par le serveur. */
export const POST = authRoute<{ companyId: string }, typeof assistantSchema>({ body: assistantSchema, rateLimit: RATE_LIMITS.ai }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "dashboard:read");
  return askAssistant(access, auth.user.id, body.messages, meta);
});
