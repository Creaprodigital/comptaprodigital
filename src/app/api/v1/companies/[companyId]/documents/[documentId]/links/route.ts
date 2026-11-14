import { authRoute } from "@/server/http/api";
import { authorizeBank, authorizeDocuments } from "@/server/modules/bank/access";
import { getDocument, linkDocument } from "@/server/modules/documents/service";
import { documentLinkSchema } from "@/lib/schemas/bank";

export const POST = authRoute<{ companyId: string; documentId: string }, typeof documentLinkSchema>({ body: documentLinkSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  if (body.entityType === "BANK_TRANSACTION") await authorizeBank(auth.user.id, params.companyId, "bank:write");
  await linkDocument(access, auth.user.id, params.documentId, body, meta);
  return getDocument(access, params.documentId);
});
