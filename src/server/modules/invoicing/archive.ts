import type { CompanyAccess } from "@/server/rbac/service";
import { archiveInvoicePdf } from "@/server/modules/documents/service";
import type { InvoiceWithDetail } from "./invoices";
import { renderInvoicePdf } from "./invoice-pdf";

/**
 * Archive l'original d'une facture ou d'un avoir au moment de son émission : le
 * PDF tel qu'il a été émis est conservé, chiffré, dans les documents de
 * l'entreprise. Un échec n'annule pas l'émission (le document reste reproductible
 * à l'identique depuis ses données figées) mais il est journalisé.
 */
export async function archiveIssuedInvoice(access: CompanyAccess, invoice: InvoiceWithDetail): Promise<void> {
  try {
    if (invoice.pdfDocumentId) return;
    const { pdf, fileName, facturX } = await renderInvoicePdf(access, invoice);
    await archiveInvoicePdf(access.company.id, invoice, pdf, fileName);
    // Format de l'original archivé : Factur-X lorsque les données sont conformes à la norme.
    await access.db.invoice.update({ where: { id: invoice.id }, data: { eInvoiceFormat: facturX.embedded ? "FACTUR_X" : null } });
    if (facturX.problems.length) console.warn(`[factures] ${invoice.number} émise sans Factur-X : ${facturX.problems.join(" ; ")}`);
  } catch (error) {
    console.error(`[factures] archivage de l'original impossible pour ${invoice.id}`, error);
  }
}
