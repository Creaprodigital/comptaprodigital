import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { loadEditorData } from "@/server/modules/invoicing/editor-data";
import { getQuoteDetail, serializeQuote } from "@/server/modules/invoicing/quotes";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor, type EditorLine } from "@/components/app/billing/document-editor";

export const metadata: Metadata = { title: "Modifier le devis" };

type Props = { params: Promise<{ quoteId: string }> };

export default async function EditQuotePage({ params }: Props) {
  const [{ access }, { quoteId }] = await Promise.all([requireCompany("quotes:write"), params]);
  const quote = serializeQuote(await getQuoteDetail(access, quoteId));
  if (quote.status !== "DRAFT") redirect(`/app/devis/${quote.id}`);
  const data = await loadEditorData(access);
  const lines: EditorLine[] = quote.items.map((item) => ({
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
      <PageHeader title={`Modifier le devis ${quote.number}`} description={quote.customerName} />
      <DocumentEditor
        kind="quote"
        {...data}
        initial={{
          id: quote.id,
          customerId: quote.customerId,
          issueDate: quote.issueDate,
          secondDate: quote.validUntil ?? "",
          serviceDate: "",
          subject: quote.subject ?? "",
          notes: quote.notes ?? "",
          terms: quote.terms ?? "",
          operationCategory: "SERVICES",
          discountType: quote.discountType,
          discountValue: quote.discountValue.replace(".", ","),
          lines,
        }}
      />
    </>
  );
}
