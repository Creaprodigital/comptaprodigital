import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { listJournals } from "@/server/modules/accounting/chart";
import { listEntries } from "@/server/modules/accounting/entries";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { ENTRY_SOURCE_LABELS } from "@/lib/accounting";
import { isIsoDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, Pagination } from "@/components/app/billing/shared";
import { AccountingTabs } from "@/components/app/accounting/shared";
import { EntriesTable } from "@/components/app/accounting/entry-actions";

export const metadata: Metadata = { title: "Écritures" };

type Search = { journal?: string; statut?: string; origine?: string; q?: string; du?: string; au?: string; page?: string };
type Props = { searchParams: Promise<Search> };
const SOURCES = Object.keys(ENTRY_SOURCE_LABELS) as Array<keyof typeof ENTRY_SOURCE_LABELS>;

export default async function EntriesPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const companyId = access.company.id;
  const query = {
    journalId: params.journal?.slice(0, 40) || undefined,
    status: params.statut === "DRAFT" ? ("DRAFT" as const) : params.statut === "VALIDATED" ? ("VALIDATED" as const) : undefined,
    source: SOURCES.find((s) => s === params.origine),
    q: params.q?.slice(0, 100) || undefined,
    from: params.du && isIsoDate(params.du) ? params.du : undefined,
    to: params.au && isIsoDate(params.au) ? params.au : undefined,
    page: Math.max(1, Number(params.page) || 1),
  };
  const [journals, result] = await Promise.all([listJournals(access), listEntries(access, query)]);
  const canWrite = access.permissions.has("accounting:write");
  const filtered = Boolean(query.journalId || query.status || query.source || query.q || query.from || query.to);
  const csv = new URLSearchParams(Object.entries({ journalId: query.journalId, from: query.from, to: query.to }).filter((e): e is [string, string] => Boolean(e[1])));

  return (
    <>
      <PageHeader
        title="Écritures"
        description={result.draftCount > 0 ? `${result.draftCount} écriture${result.draftCount > 1 ? "s" : ""} au brouillard.` : "Toutes les écritures sont validées."}
        actions={
          <>
            {access.permissions.has("exports:run") ? (
              <Button asChild variant="outline">
                <a href={`/api/v1/companies/${companyId}/accounting/reports/journal${csv.size ? `?${csv}` : ""}`} download><DownloadIcon /> Journaux (CSV)</a>
              </Button>
            ) : null}
            {canWrite ? (
              <Button asChild>
                <Link href="/app/comptabilite/ecritures/nouvelle"><PlusIcon /> Nouvelle écriture</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AccountingTabs current="ecritures" />
      <form action="/app/comptabilite/ecritures" method="get" role="search" className="mb-4 grid gap-2 rounded-2xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <Input name="q" type="search" defaultValue={query.q} placeholder="Libellé, pièce, compte ou n°" aria-label="Rechercher une écriture" />
        <NativeSelect name="journal" defaultValue={query.journalId ?? ""} aria-label="Journal">
          <option value="">Tous les journaux</option>
          {journals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
        </NativeSelect>
        <NativeSelect name="statut" defaultValue={query.status ?? ""} aria-label="Statut">
          <option value="">Brouillard et validées</option>
          <option value="DRAFT">Brouillard</option>
          <option value="VALIDATED">Validées</option>
        </NativeSelect>
        <NativeSelect name="origine" defaultValue={query.source ?? ""} aria-label="Origine">
          <option value="">Toutes les origines</option>
          {SOURCES.map((s) => <option key={s} value={s}>{ENTRY_SOURCE_LABELS[s]}</option>)}
        </NativeSelect>
        <Input name="du" type="date" defaultValue={query.from} aria-label="Du" />
        <Input name="au" type="date" defaultValue={query.to} aria-label="Au" />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">Filtrer</Button>
          {filtered ? <Button asChild variant="ghost"><Link href="/app/comptabilite/ecritures">Effacer</Link></Button> : null}
        </div>
      </form>
      {result.items.length === 0 ? (
        <EmptyState title={filtered ? "Aucune écriture ne correspond" : "Aucune écriture"} description={filtered ? "Modifiez les filtres." : "Les écritures apparaissent dès que vous émettez une facture, saisissez un achat ou importez un relevé bancaire."} />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <EntriesTable companyId={companyId} entries={result.items} canWrite={canWrite} currency={access.company.currency} />
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/comptabilite/ecritures" page={result.page} pageSize={result.pageSize} total={result.total} params={{ journal: query.journalId, statut: query.status, origine: query.source, q: query.q, du: query.from, au: query.to }} />
    </>
  );
}
