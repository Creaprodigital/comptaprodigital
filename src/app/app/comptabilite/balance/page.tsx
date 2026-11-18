import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, DownloadIcon } from "lucide-react";
import { listFiscalYears } from "@/server/modules/accounting/closing";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { trialBalance } from "@/server/modules/accounting/reports";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/billing/shared";
import { AccountingTabs, Amount, PeriodFilter, exportQuery, reportParams } from "@/components/app/accounting/shared";

export const metadata: Metadata = { title: "Balance générale" };

type Props = { searchParams: Promise<{ exercice?: string; du?: string; au?: string; brouillard?: string }> };

export default async function BalancePage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const filter = reportParams(params);
  const [balance, years] = await Promise.all([trialBalance(access, filter), listFiscalYears(access)]);
  const currency = access.company.currency;
  const result = Number(balance.result);
  return (
    <>
      <PageHeader
        title="Balance générale"
        description={`${balance.period.fiscalYear.label} — du ${formatDate(balance.period.from)} au ${formatDate(balance.period.to)}.`}
        actions={access.permissions.has("exports:run") ? <Button asChild variant="outline"><a href={`/api/v1/companies/${access.company.id}/accounting/reports/balance?${exportQuery({ ...filter, fiscalYearId: balance.period.fiscalYear.id })}`} download><DownloadIcon /> Exporter (CSV)</a></Button> : undefined}
      />
      <AccountingTabs current="balance" />
      <PeriodFilter action="/app/comptabilite/balance" fiscalYears={years} fiscalYearId={balance.period.fiscalYear.id} from={balance.period.from} to={balance.period.to} includeDrafts={balance.includeDrafts} />
      {balance.includeDrafts && balance.draftCount > 0 ? (
        <Alert variant="warning" className="mb-4">
          <AlertTriangleIcon />
          <AlertDescription>Cette balance inclut {balance.draftCount} écriture{balance.draftCount > 1 ? "s" : ""} du brouillard, non encore validée{balance.draftCount > 1 ? "s" : ""}.</AlertDescription>
        </Alert>
      ) : null}
      {balance.classes.length === 0 ? (
        <EmptyState title="Aucun mouvement" description="Aucune écriture sur cette période." />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Total des débits", balance.totals.debit],
              ["Total des crédits", balance.totals.credit],
              [result >= 0 ? "Résultat (bénéfice)" : "Résultat (perte)", balance.result.replace("-", "")],
            ].map(([label, value]) => (
              <Card key={label}><CardContent className="py-4"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="tabular mt-1 font-display text-2xl font-bold">{formatCurrency(value, { currency })}</p></CardContent></Card>
            ))}
          </div>
          {!balance.balanced ? <p className="mb-4 text-sm font-medium text-destructive-foreground">La balance n'est pas équilibrée : signalez-le au support.</p> : null}
          <Card>
            <CardContent className="px-2 py-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Compte</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="hidden text-right md:table-cell">Solde débiteur</TableHead><TableHead className="hidden text-right md:table-cell">Solde créditeur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balance.classes.flatMap((cls) => [
                    <TableRow key={`c${cls.digit}`} className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={5} className="text-xs font-semibold tracking-wide uppercase">Classe {cls.digit} — {cls.label}</TableCell>
                    </TableRow>,
                    ...cls.accounts.map((a) => (
                      <TableRow key={a.accountNumber}>
                        <TableCell>
                          <Link href={`/app/comptabilite/grand-livre?compte=${a.accountNumber}&exercice=${balance.period.fiscalYear.id}`} className="tabular font-medium hover:text-primary hover:underline">{a.accountNumber}</Link>
                          <span className="ml-2 text-sm text-muted-foreground">{a.accountLabel}</span>
                        </TableCell>
                        <TableCell className="text-right"><Amount value={a.debit} currency={currency} /></TableCell>
                        <TableCell className="text-right"><Amount value={a.credit} currency={currency} /></TableCell>
                        <TableCell className="hidden text-right md:table-cell"><Amount value={a.balanceDebit} currency={currency} /></TableCell>
                        <TableCell className="hidden text-right md:table-cell"><Amount value={a.balanceCredit} currency={currency} /></TableCell>
                      </TableRow>
                    )),
                    <TableRow key={`t${cls.digit}`} className="hover:bg-transparent">
                      <TableCell className="text-sm font-semibold">Total classe {cls.digit}</TableCell>
                      <TableCell className="text-right"><Amount value={cls.debit} currency={currency} strong /></TableCell>
                      <TableCell className="text-right"><Amount value={cls.credit} currency={currency} strong /></TableCell>
                      <TableCell className="hidden text-right md:table-cell"><Amount value={cls.balanceDebit} currency={currency} strong /></TableCell>
                      <TableCell className="hidden text-right md:table-cell"><Amount value={cls.balanceCredit} currency={currency} strong /></TableCell>
                    </TableRow>,
                  ])}
                  <TableRow className="border-t-2 hover:bg-transparent">
                    <TableCell className="font-bold">Total général</TableCell>
                    <TableCell className="text-right"><Amount value={balance.totals.debit} currency={currency} strong /></TableCell>
                    <TableCell className="text-right"><Amount value={balance.totals.credit} currency={currency} strong /></TableCell>
                    <TableCell className="hidden text-right md:table-cell"><Amount value={balance.totals.balanceDebit} currency={currency} strong /></TableCell>
                    <TableCell className="hidden text-right md:table-cell"><Amount value={balance.totals.balanceCredit} currency={currency} strong /></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
