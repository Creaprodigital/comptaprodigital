import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { buildInvoiceDocument } from "@/server/modules/invoicing/document-model";
import { getInvoiceDetail } from "@/server/modules/invoicing/invoices";
import { pdfFileName, renderDocumentPdf } from "@/server/modules/invoicing/pdf";

export const GET = authRoute<{ companyId: string; invoiceId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  const document = await buildInvoiceDocument(access, await getInvoiceDetail(access, params.invoiceId));
  const pdf = await renderDocumentPdf(document);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFileName(document)}"`, "Cache-Control": "private, no-store" },
  });
});
