import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { listAccounts, listJournals } from "@/server/modules/accounting/chart";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { todayInParis } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { EntryEditor } from "@/components/app/accounting/entry-editor";

export const metadata: Metadata = { title: "Nouvelle écriture" };

export default async function NewEntryPage() {
  const { access, state } = await accountingPageAccess();
  if (state !== "ok" || !access.permissions.has("accounting:write")) redirect("/app/comptabilite/ecritures");
  const [journals, accounts] = await Promise.all([listJournals(access), listAccounts(access)]);
  return (
    <>
      <Link href="/app/comptabilite/ecritures" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Écritures
      </Link>
      <PageHeader title="Nouvelle écriture" description="Opérations diverses : reclassement, apport, salaires, régularisation… L'écriture est enregistrée au brouillard, puis validée." />
      <EntryEditor companyId={access.company.id} journals={journals.filter((j) => j.isActive)} accounts={accounts.filter((a) => a.isActive).map((a) => ({ number: a.number, label: a.label }))} today={todayInParis()} />
    </>
  );
}
