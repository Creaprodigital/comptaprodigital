import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { contentDisposition } from "@/server/http/upload";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeDocuments } from "@/server/modules/bank/access";
import { exportDocumentsArchive } from "@/server/modules/documents/service";
import { documentsQuerySchema } from "@/lib/schemas/bank";

/** Archive ZIP des documents correspondant aux filtres. */
export const GET = authRoute<{ companyId: string }, undefined, typeof documentsQuerySchema>({ query: documentsQuerySchema, rateLimit: RATE_LIMITS.exports }, async ({ auth, params, query, meta }) => {
  const access = await authorizeDocuments(auth.user.id, params.companyId, "documents:read");
  const { fileName, zip } = await exportDocumentsArchive(access, auth.user.id, query, meta);
  return new NextResponse(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition("attachment", fileName), "Cache-Control": "private, no-store" },
  });
});
