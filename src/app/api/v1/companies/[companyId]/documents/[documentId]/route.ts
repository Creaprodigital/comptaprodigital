import { authRoute, noContent } from "@/server/http/api";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { deleteDocument, getDocument, getDocumentHistory, updateDocument } from "@/server/modules/documents/service";
import { documentUpdateSchema } from "@/lib/schemas/bank";

type Params = { companyId: string; documentId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:read");
  const [document, history] = await Promise.all([getDocument(access, params.documentId), getDocumentHistory(access, params.documentId)]);
  return { document, history };
});

export const PATCH = authRoute<Params, typeof documentUpdateSchema>({ body: documentUpdateSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  return updateDocument(access, auth.user.id, params.documentId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:delete");
  await deleteDocument(access, auth.user.id, params.documentId, meta);
  return noContent();
});
