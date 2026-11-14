import { authRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeBank } from "@/server/modules/bank/access";
import { previewImport } from "@/server/modules/bank/imports";
import { readStatementUpload } from "@/server/modules/bank/upload";

/** Aperçu d'un relevé avant import : rien n'est enregistré. */
export const POST = authRoute<{ companyId: string }>({ rateLimit: RATE_LIMITS.uploads }, async ({ auth, params, request }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return previewImport(access, await readStatementUpload(request));
});
