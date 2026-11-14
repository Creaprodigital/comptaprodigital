import { authRoute } from "@/server/http/api";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { getDocument, unlinkDocument } from "@/server/modules/documents/service";

export const DELETE = authRoute<{ companyId: string; documentId: string; linkId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  await unlinkDocument(access, auth.user.id, params.documentId, params.linkId, meta);
  return getDocument(access, params.documentId);
});
