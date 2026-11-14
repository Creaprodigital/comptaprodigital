import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { loadEditorData } from "@/server/modules/invoicing/editor-data";
import { getInvoiceDetail, serializeInvoice } from "@/server/modules/invoicing/invoices";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor, type EditorLine } from "@/components/app/billing/document-editor";

export const metadata: Metadata = { title: "Modifier la facture" };

type Props = { params: Promise<{ invoiceId: string }> };

export default async function EditInvoicePage({ params }: Props) {
  const [{ access }, { invoiceId }] = await Promise.all([requireCompany("invoices:write"), params]);
  const invoice = serializeInvoice(await getInvoiceDetail(access, invoiceId));
  // Seul un brouillon est modifiable : une facture émise renvoie vers sa fiche.
  if (invoice.status !== "DRAFT" || invoice.type === "CREDIT_NOTE") redirect(`/app/factures/${invoice.id}`);
  const data = await loadEditorData(access);
  const lines: EditorLine[] = invoice.items.map((item) => ({
    key: item.id,
    productId: item.productId ?? "",
    description: item.description,
    quantity: item.quantity.replace(".", ","),
    unit: item.unit ?? "",
    unitPriceExclTax: item.unitPriceExclTax.replace(".", ","),
    discountRate: item.discountRate.replace(".", ","),
    vatRate: Number(item.vatRate).toFixed(2),
  }));
  return (
    <>
      <PageHeader title="Modifier le brouillon" description={`${invoice.customerName} — facture non émise`} />
      <DocumentEditor
        kind="invoice"
        {...data}
        initial={{
          id: invoice.id,
          customerId: invoice.customerId,
          issueDate: invoice.issueDate ?? "",
          secondDate: invoice.dueDate ?? "",
          serviceDate: invoice.serviceDate ?? "",
          subject: invoice.subject ?? "",
          notes: invoice.notes ?? "",
          terms: invoice.paymentTerms ?? "",
          operationCategory: invoice.operationCategory,
          discountType: invoice.discountType,
          discountValue: invoice.discountValue.replace(".", ","),
          lines,
        }}
      />
    </>
  );
}
