import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { buildQuoteDocument } from "@/server/modules/invoicing/document-model";
import { pdfFileName, renderDocumentPdf } from "@/server/modules/invoicing/pdf";
import { getQuoteDetail } from "@/server/modules/invoicing/quotes";

export const GET = authRoute<{ companyId: string; quoteId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:read");
  const document = await buildQuoteDocument(access, await getQuoteDetail(access, params.quoteId));
  const pdf = await renderDocumentPdf(document);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFileName(document)}"`, "Cache-Control": "private, no-store" },
  });
});
