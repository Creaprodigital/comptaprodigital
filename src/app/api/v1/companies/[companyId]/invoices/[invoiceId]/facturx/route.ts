import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { errors } from "@/server/http/errors";
import { getInvoiceDetail } from "@/server/modules/invoicing/invoices";
import { buildFacturX } from "@/server/modules/invoicing/facturx";

/**
 * XML Factur-X (CII, profil EN 16931) d'une facture émise.
 * ?format=json : état de conformité (anomalies à corriger), sans le XML.
 */
export const GET = authRoute<{ companyId: string; invoiceId: string }>({}, async ({ auth, params, request }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:read");
  const invoice = await getInvoiceDetail(access, params.invoiceId);
  if (invoice.status === "DRAFT" || !invoice.number) throw errors.badRequest("INVOICE_NOT_ISSUED", "Un brouillon n'a pas de version électronique : émettez d'abord la facture.");
  const { xml, problems } = buildFacturX(access.company, invoice);
  if (request.nextUrl.searchParams.get("format") === "json") return { conform: problems.length === 0, problems };
  if (problems.length) throw errors.badRequest("FACTURX_NOT_CONFORM", `Facture électronique non conforme : ${problems.join(" ; ")}`);
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="factur-x-${invoice.number}.xml"`, "Cache-Control": "private, no-store" },
  });
});
