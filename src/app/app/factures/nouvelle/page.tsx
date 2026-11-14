import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { loadEditorData } from "@/server/modules/invoicing/editor-data";
import { addDays, todayInParis } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/app/billing/document-editor";

export const metadata: Metadata = { title: "Nouvelle facture" };

type Props = { searchParams: Promise<{ client?: string }> };

export default async function NewInvoicePage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("invoices:write"), searchParams]);
  const data = await loadEditorData(access);
  const today = todayInParis();
  const customer = data.customers.find((c) => c.id === params.client);
  return (
    <>
      <PageHeader title="Nouvelle facture" description="La facture est enregistrée en brouillon : elle ne reçoit son numéro qu'à l'émission." />
      <DocumentEditor
        kind="invoice"
        {...data}
        initial={{
          customerId: customer?.id ?? "",
          issueDate: today,
          secondDate: addDays(today, customer?.paymentTermDays ?? data.defaults.paymentTermDays),
          serviceDate: "",
          subject: "",
          notes: "",
          terms: "",
          operationCategory: "SERVICES",
          discountType: "NONE",
          discountValue: "0",
          lines: [],
        }}
      />
    </>
  );
}
