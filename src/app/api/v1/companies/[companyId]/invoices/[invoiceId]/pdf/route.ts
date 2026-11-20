import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { getInvoiceDetail } from "@/server/modules/invoicing/invoices";
import { renderInvoicePdf } from "@/server/modules/invoicing/invoice-pdf";

/** PDF de la facture : au format Factur-X (PDF/A-3 + XML EN 16931) une fois émise et conforme. */
export const GET = authRoute<{ companyId: string; invoiceId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  const { pdf, fileName, facturX } = await renderInvoicePdf(access, await getInvoiceDetail(access, params.invoiceId));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Factur-X": facturX.embedded ? "EN16931" : "non",
    },
  });
});
