import { authRoute, created, validate } from "@/server/http/api";
import { readUpload } from "@/server/http/upload";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeBank, authorizeDocuments } from "@/server/modules/bank/access";
import { listDocuments, uploadDocument } from "@/server/modules/documents/service";
import { MAX_DOCUMENT_BYTES } from "@/lib/bank";
import { documentUploadFieldsSchema, documentsQuerySchema } from "@/lib/schemas/bank";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof documentsQuerySchema>({ query: documentsQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:read");
  return listDocuments(access, query);
});

/** Ajout d'un document (multipart : `file`, et facultativement `category`, `documentDate`, `entityType` + `entityId`). */
export const POST = authRoute<Params>({ rateLimit: RATE_LIMITS.uploads }, async ({ auth, params, request, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  const { files, fields } = await readUpload(request, { maxFileBytes: MAX_DOCUMENT_BYTES });
  const input = validate(documentUploadFieldsSchema, fields);
  const link = input.entityType && input.entityId ? { entityType: input.entityType, entityId: input.entityId } : undefined;
  // Associer un justificatif à une opération bancaire modifie cette opération : le droit correspondant est requis.
  if (link?.entityType === "BANK_TRANSACTION") await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await uploadDocument(access, auth.user.id, { fileName: files[0].name, bytes: files[0].bytes, category: input.category, documentDate: input.documentDate, link }, meta));
});
