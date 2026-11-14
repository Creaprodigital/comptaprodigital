import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { loadEditorData } from "@/server/modules/invoicing/editor-data";
import { addDays, todayInParis } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/app/billing/document-editor";

export const metadata: Metadata = { title: "Nouveau devis" };

export default async function NewQuotePage() {
  const { access } = await requireCompany("quotes:write");
  const data = await loadEditorData(access);
  const today = todayInParis();
  return (
    <>
      <PageHeader title="Nouveau devis" description="Le devis reste modifiable tant qu'il est en brouillon." />
      <DocumentEditor
        kind="quote"
        {...data}
        initial={{
          customerId: "",
          issueDate: today,
          secondDate: addDays(today, data.defaults.validityDays),
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
