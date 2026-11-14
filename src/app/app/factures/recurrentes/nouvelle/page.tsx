import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { loadEditorData } from "@/server/modules/invoicing/editor-data";
import { todayInParis } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/app/billing/document-editor";

export const metadata: Metadata = { title: "Nouvelle facture récurrente" };

export default async function NewRecurringInvoicePage() {
  const { access } = await requireCompany("invoices:issue");
  if (!(await companyHasModule(access.company.id, "invoicing-advanced"))) redirect("/app/factures/recurrentes");
  const data = await loadEditorData(access);
  return (
    <>
      <PageHeader title="Nouvelle facture récurrente" description="Chaque facture générée est datée du jour de sa création, pour respecter la chronologie de la numérotation." />
      <DocumentEditor
        kind="recurring"
        {...data}
        initial={{
          customerId: "",
          issueDate: todayInParis(),
          secondDate: "",
          serviceDate: "",
          subject: "",
          notes: "",
          terms: "",
          operationCategory: "SERVICES",
          discountType: "NONE",
          discountValue: "0",
          lines: [],
          label: "",
          frequency: "MONTHLY",
          autoIssue: false,
          autoSend: false,
        }}
      />
    </>
  );
}
