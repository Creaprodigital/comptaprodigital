import type { CompanyAccess } from "@/server/rbac/service";
import { buildInvoiceDocument } from "./document-model";
import { buildFacturX } from "./facturx";
import type { InvoiceWithDetail } from "./invoices";
import { pdfFileName, renderDocumentPdf } from "./pdf";

export type InvoicePdf = {
  pdf: Buffer;
  fileName: string;
  /** Facture électronique incorporée (PDF/A-3 + XML EN 16931) ; sinon, raisons de la non-conformité. */
  facturX: { embedded: boolean; problems: string[] };
};

/**
 * PDF d'une facture, d'un acompte ou d'un avoir. Une fois émis, le document est produit au
 * format Factur-X si ses données passent les contrôles de la norme EN 16931 ; sinon il reste
 * un PDF simple et les anomalies sont retournées pour être corrigées (paramètres de l'entreprise,
 * fiche client). Un brouillon n'a jamais de version électronique.
 */
export async function renderInvoicePdf(access: CompanyAccess, invoice: InvoiceWithDetail): Promise<InvoicePdf> {
  const document = await buildInvoiceDocument(access, invoice);
  const fileName = pdfFileName(document);
  if (invoice.status === "DRAFT" || !invoice.number || !invoice.issueDate) {
    return { pdf: await renderDocumentPdf(document), fileName, facturX: { embedded: false, problems: [] } };
  }
  const { xml, problems } = buildFacturX(access.company, invoice);
  if (problems.length) return { pdf: await renderDocumentPdf(document), fileName, facturX: { embedded: false, problems } };
  const pdf = await renderDocumentPdf(document, { facturX: { xml, conformanceLevel: "EN 16931", documentDate: invoice.issuedAt ?? invoice.issueDate } });
  return { pdf, fileName, facturX: { embedded: true, problems: [] } };
}
