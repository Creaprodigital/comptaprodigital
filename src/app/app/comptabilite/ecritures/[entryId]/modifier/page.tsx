import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { AppError } from "@/server/http/errors";
import { listAccounts, listJournals } from "@/server/modules/accounting/chart";
import { getEntry } from "@/server/modules/accounting/entries";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { todayInParis } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { EntryEditor } from "@/components/app/accounting/entry-editor";

export const metadata: Metadata = { title: "Modifier l'écriture" };
export const instant = false;

type Props = { params: Promise<{ entryId: string }> };

export default async function EditEntryPage({ params }: Props) {
  const [{ access, state }, { entryId }] = await Promise.all([accountingPageAccess(), params]);
  if (state !== "ok") redirect("/app/comptabilite");
  const entry = await getEntry(access, entryId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  if (!entry.editable || !access.permissions.has("accounting:write")) redirect(`/app/comptabilite/ecritures/${entryId}`);
  const [journals, accounts] = await Promise.all([listJournals(access), listAccounts(access)]);
  return (
    <>
      <Link href={`/app/comptabilite/ecritures/${entryId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Retour à l'écriture
      </Link>
      <PageHeader title="Modifier l'écriture" description="Une écriture du brouillard reste modifiable jusqu'à sa validation." />
      <EntryEditor companyId={access.company.id} journals={journals.filter((j) => j.isActive)} accounts={accounts.filter((a) => a.isActive).map((a) => ({ number: a.number, label: a.label }))} entry={entry} today={todayInParis()} />
    </>
  );
}
