import { NextResponse } from "next/server";
import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { contentDisposition } from "@/server/http/upload";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { detectFileType, getDocumentContent } from "@/server/modules/documents/service";

const querySchema = z.object({ download: z.enum(["1"]).optional() });

/**
 * Contenu d'un document, après contrôle des droits. Le type servi est celui du
 * contenu (PDF, JPEG ou PNG, jamais un type exécutable). Les en-têtes de sécurité
 * propres à cette route (affichage dans un cadre de l'application) sont dans next.config.ts.
 */
export const GET = authRoute<{ companyId: string; documentId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:read");
  const download = query.download === "1";
  const { document, bytes } = await getDocumentContent(access, auth.user.id, params.documentId, { download }, meta);
  const type = detectFileType(bytes);
  const fileName = `${document.name}.${type?.extension ?? "bin"}`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type?.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(download || !type ? "attachment" : "inline", fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
