import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { AppError } from "@/server/http/errors";
import { getEntry } from "@/server/modules/accounting/entries";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { sourceHref } from "@/server/modules/accounting/source-links";
import { documentHistory } from "@/server/modules/invoicing/shared";
import { ENTRY_SOURCE_LABELS } from "@/lib/accounting";
import { todayInParis } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { sum, toMoneyString } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HistoryList } from "@/components/app/billing/shared";
import { Amount, EntryStatusBadge } from "@/components/app/accounting/shared";
import { EntryActions } from "@/components/app/accounting/entry-actions";

export const metadata: Metadata = { title: "Écriture" };
export const instant = false;

type Props = { params: Promise<{ entryId: string }> };

export default async function EntryPage({ params }: Props) {
  const [{ access, state }, { entryId }] = await Promise.all([accountingPageAccess(), params]);
  if (state !== "ok") redirect("/app/comptabilite");
  const entry = await getEntry(access, entryId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const [href, history] = await Promise.all([sourceHref(access, entry.sourceType, entry.sourceId), documentHistory(access.company.id, "AccountingEntry", entry.id)]);
  const currency = access.company.currency;
  const details: Array<[string, React.ReactNode]> = [
    ["Journal", `${entry.journal.code} — ${entry.journal.label}`],
    ["Date", formatDate(entry.date, "long")],
    ["Exercice", entry.fiscalYear.label],
    ["Pièce", `${entry.pieceRef ?? "—"}${entry.pieceDate && entry.pieceDate !== entry.date ? ` du ${formatDate(entry.pieceDate)}` : ""}`],
    ["Origine", href ? <Link href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{ENTRY_SOURCE_LABELS[entry.sourceType]} <ExternalLinkIcon className="size-3.5" /></Link> : ENTRY_SOURCE_LABELS[entry.sourceType]],
    ["Validation", entry.validatedAt ? formatDateTime(entry.validatedAt) : "Au brouillard"],
  ];

  return (
    <>
      <Link href="/app/comptabilite/ecritures" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Écritures
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words sm:text-[28px]">{entry.number ? `Écriture n° ${entry.number}` : "Écriture au brouillard"}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{entry.label}</span>
            <EntryStatusBadge status={entry.status} />
          </p>
        </div>
        {access.permissions.has("accounting:write") ? <EntryActions companyId={access.company.id} entry={entry} today={todayInParis()} /> : null}
      </div>
      {entry.reversalOf || entry.reversedBy ? (
        <p className="mb-4 rounded-xl border bg-accent px-4 py-3 text-sm">
          {entry.reversalOf ? <>Contre-passation de <Link href={`/app/comptabilite/ecritures/${entry.reversalOf.id}`} className="font-medium text-primary hover:underline">l'écriture n° {entry.reversalOf.number}</Link>.</> : null}
          {entry.reversedBy ? <>Contre-passée par <Link href={`/app/comptabilite/ecritures/${entry.reversedBy.id}`} className="font-medium text-primary hover:underline">{entry.reversedBy.number ? `l'écriture n° ${entry.reversedBy.number}` : "une écriture au brouillard"}</Link>.</> : null}
        </p>
      ) : null}
      {entry.status === "DRAFT" && !entry.editable && entry.sourceType !== "MANUAL" ? (
        <p className="mb-4 rounded-xl border px-4 py-3 text-sm text-muted-foreground">Cette écriture découle de sa pièce d'origine : pour la corriger, modifiez la pièce (catégorie d'une opération, facture d'achat…). L'écriture sera recalculée.</p>
      ) : null}
      <div className="grid items-start gap-6 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Compte</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Débit</TableHead>
                  <TableHead className="text-right">Crédit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Link href={`/app/comptabilite/grand-livre?compte=${line.accountNumber}&exercice=${entry.fiscalYear.id}`} className="tabular font-medium hover:text-primary hover:underline">{line.accountNumber}</Link>
                      <p className="text-xs text-muted-foreground">{line.accountLabel}{line.auxiliaryNumber ? ` · ${line.auxiliaryNumber} ${line.auxiliaryLabel ?? ""}` : ""}{line.letter ? ` · lettrage ${line.letter}` : ""}</p>
                    </TableCell>
                    <TableCell className="max-w-[18rem] text-sm">{line.label}</TableCell>
                    <TableCell className="text-right"><Amount value={line.debit} currency={currency} /></TableCell>
                    <TableCell className="text-right"><Amount value={line.credit} currency={currency} /></TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                  <TableCell className="text-right"><Amount value={toMoneyString(sum(entry.lines.map((l) => l.debit)))} currency={currency} strong /></TableCell>
                  <TableCell className="text-right"><Amount value={toMoneyString(sum(entry.lines.map((l) => l.credit)))} currency={currency} strong /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid gap-6">
          <Card>
            <CardContent className="py-5">
              <dl className="grid gap-3 text-sm">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent><HistoryList entries={history} /></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
