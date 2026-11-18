import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { listFiscalYears } from "@/server/modules/accounting/closing";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { generalLedger } from "@/server/modules/accounting/reports";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/billing/shared";
import { AccountingTabs, Amount, PeriodFilter, exportQuery, reportParams } from "@/components/app/accounting/shared";

export const metadata: Metadata = { title: "Grand livre" };

type Props = { searchParams: Promise<{ exercice?: string; du?: string; au?: string; brouillard?: string; compte?: string }> };

export default async function LedgerPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const filter = reportParams(params);
  const [ledger, years] = await Promise.all([generalLedger(access, filter), listFiscalYears(access)]);
  const currency = access.company.currency;
  return (
    <>
      <PageHeader
        title="Grand livre"
        description={`${ledger.period.fiscalYear.label} — du ${formatDate(ledger.period.from)} au ${formatDate(ledger.period.to)}${ledger.includeDrafts ? ", brouillard compris" : ", écritures validées"}.`}
        actions={access.permissions.has("exports:run") ? <Button asChild variant="outline"><a href={`/api/v1/companies/${access.company.id}/accounting/reports/ledger?${exportQuery({ ...filter, fiscalYearId: ledger.period.fiscalYear.id })}`} download><DownloadIcon /> Exporter (CSV)</a></Button> : undefined}
      />
      <AccountingTabs current="grand-livre" />
      <PeriodFilter action="/app/comptabilite/grand-livre" fiscalYears={years} fiscalYearId={ledger.period.fiscalYear.id} from={ledger.period.from} to={ledger.period.to} includeDrafts={ledger.includeDrafts}>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Compte (ou début)
          <Input name="compte" defaultValue={filter.account} inputMode="numeric" placeholder="ex. 411, 6" className="h-9 w-36" />
        </label>
      </PeriodFilter>
      {ledger.accounts.length === 0 ? (
        <EmptyState title="Aucun mouvement" description="Aucune écriture ne correspond à cette période ou à ce compte." />
      ) : (
        <div className="grid gap-4">
          {ledger.accounts.map((account) => (
            <Card key={account.accountNumber}>
              <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="text-base">
                  <span className="tabular">{account.accountNumber}</span> — {account.accountLabel}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Solde : <span className="tabular font-semibold text-foreground">{Number(account.closing) === 0 ? "soldé" : `${Number(account.closing) > 0 ? "débiteur" : "créditeur"} de `}</span>
                  {Number(account.closing) !== 0 ? <Amount value={account.closing.replace("-", "")} currency={currency} strong /> : null}
                </p>
              </CardHeader>
              <CardContent className="px-2 pb-2 sm:px-4">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead><TableHead>Jnl</TableHead><TableHead className="hidden sm:table-cell">N°</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="hidden text-right md:table-cell">Solde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Number(account.opening) !== 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">Report au {formatDate(ledger.period.from)}</TableCell>
                        <TableCell /><TableCell />
                        <TableCell className="hidden text-right md:table-cell"><Amount value={account.opening} currency={currency} /></TableCell>
                      </TableRow>
                    ) : null}
                    {account.lines.map((line) => (
                      <TableRow key={line.id} className={line.draft ? "text-muted-foreground" : undefined}>
                        <TableCell className="tabular whitespace-nowrap">{formatDate(line.date)}</TableCell>
                        <TableCell>{line.journal}</TableCell>
                        <TableCell className="tabular hidden sm:table-cell">{line.entryNumber ?? "brouill."}</TableCell>
                        <TableCell className="max-w-[22rem]">
                          <Link href={`/app/comptabilite/ecritures/${line.entryId}`} className="block truncate hover:text-primary hover:underline">{line.label}</Link>
                          {line.auxiliaryNumber || line.letter ? <p className="text-xs text-muted-foreground">{[line.auxiliaryNumber, line.letter ? `lettrage ${line.letter}` : null].filter(Boolean).join(" · ")}</p> : null}
                        </TableCell>
                        <TableCell className="text-right"><Amount value={line.debit} currency={currency} /></TableCell>
                        <TableCell className="text-right"><Amount value={line.credit} currency={currency} /></TableCell>
                        <TableCell className="hidden text-right md:table-cell"><Amount value={line.balance} currency={currency} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="font-semibold">Total des mouvements</TableCell>
                      <TableCell className="text-right"><Amount value={account.debit} currency={currency} strong /></TableCell>
                      <TableCell className="text-right"><Amount value={account.credit} currency={currency} strong /></TableCell>
                      <TableCell className="hidden md:table-cell" />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {ledger.truncated ? <p className="text-sm text-warning-foreground">Affichage limité : précisez un compte ou une période, ou exportez le grand livre complet.</p> : null}
        </div>
      )}
    </>
  );
}
