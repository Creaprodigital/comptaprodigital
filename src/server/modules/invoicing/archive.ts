import type { CompanyAccess } from "@/server/rbac/service";
import { archiveInvoicePdf } from "@/server/modules/documents/service";
import { buildInvoiceDocument } from "./document-model";
import type { InvoiceWithDetail } from "./invoices";
import { pdfFileName, renderDocumentPdf } from "./pdf";

/**
 * Archive l'original d'une facture ou d'un avoir au moment de son émission : le
 * PDF tel qu'il a été émis est conservé, chiffré, dans les documents de
 * l'entreprise. Un échec n'annule pas l'émission (le document reste reproductible
 * à l'identique depuis ses données figées) mais il est journalisé.
 */
export async function archiveIssuedInvoice(access: CompanyAccess, invoice: InvoiceWithDetail): Promise<void> {
  try {
    if (invoice.pdfDocumentId) return;
    const document = await buildInvoiceDocument(access, invoice);
    await archiveInvoicePdf(access.company.id, invoice, await renderDocumentPdf(document), pdfFileName(document));
  } catch (error) {
    console.error(`[factures] archivage de l'original impossible pour ${invoice.id}`, error);
  }
}
