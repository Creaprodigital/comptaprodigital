import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { aiStatus, setAiEnabled } from "@/server/ai/service";
import { aiToggleSchema } from "@/lib/schemas/ai";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:read");
  return aiStatus(access.company);
});

/** Activation ou désactivation de l'assistant IA (consentement du titulaire ou d'un administrateur). */
export const PUT = authRoute<Params, typeof aiToggleSchema>({ body: aiToggleSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  return setAiEnabled(access, auth.user.id, body.enabled, meta);
});
