import { authRoute, created } from "@/server/http/api";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { errors } from "@/server/http/errors";
import { createPurchaseFromDocument } from "@/server/ai/documents";

/** Crée la facture d'achat correspondant à une lecture vérifiée. */
export const POST = authRoute<{ companyId: string; documentId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:write");
  if (!access.permissions.has("purchases:write")) throw errors.forbidden();
  return created(await createPurchaseFromDocument(access, auth.user.id, params.documentId, meta));
});
