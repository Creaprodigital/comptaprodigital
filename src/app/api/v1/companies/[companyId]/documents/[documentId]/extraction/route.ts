import { authRoute } from "@/server/http/api";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { extractDocument, getExtraction, verifiedExtractionSchema, verifyExtraction } from "@/server/ai/documents";

type Params = { companyId: string; documentId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:read");
  return getExtraction(access, params.documentId);
});

/** Lecture automatique du document par l'IA (résultat à vérifier). */
export const POST = authRoute<Params>({ rateLimit: RATE_LIMITS.ai }, async ({ auth, params, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  return extractDocument(access, auth.user.id, params.documentId, meta);
});

/** Validation, avec corrections éventuelles, des informations lues. */
export const PUT = authRoute<Params, typeof verifiedExtractionSchema>({ body: verifiedExtractionSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  return verifyExtraction(access, auth.user.id, params.documentId, body, meta);
});
