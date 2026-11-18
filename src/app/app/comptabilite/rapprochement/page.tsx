import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, AlertTriangleIcon } from "lucide-react";
import { listBankAccounts } from "@/server/modules/bank/accounts";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { bankReconciliation } from "@/server/modules/accounting/reports";
import { isIsoDate, todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/billing/shared";
import { AccountingTabs } from "@/components/app/accounting/shared";

export const metadata: Metadata = { title: "Rapprochement bancaire" };

type Props = { searchParams: Promise<{ compte?: string; date?: string }> };

export default async function BankReconciliationPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const accounts = await listBankAccounts(access, { includeInactive: true });
  const date = params.date && isIsoDate(params.date) ? params.date : todayInParis();
  const account = accounts.find((a) => a.id === params.compte) ?? accounts[0];
  const report = account ? await bankReconciliation(access, account.id, date) : null;
  const currency = access.company.currency;
  const balanced = report && Number(report.difference) === 0;

  return (
    <>
      <PageHeader title="Rapprochement bancaire" description="Concordance entre le solde de la banque (relevés importés) et le compte 512 de la comptabilité." />
      <AccountingTabs current="rapprochement" />
      {!report ? (
        <EmptyState title="Aucun compte bancaire" description="Ajoutez un compte bancaire pour établir son rapprochement." />
      ) : (
        <>
          <form method="get" action="/app/comptabilite/rapprochement" className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-xs">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">Compte<NativeSelect name="compte" defaultValue={account!.id} className="h-9 w-60">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">Au<Input type="date" name="date" defaultValue={date} className="h-9 w-40" /></label>
            <Button type="submit" variant="outline" size="sm" className="h-9">Afficher</Button>
          </form>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {[["Solde bancaire", report.bankBalance], [`Solde comptable (${report.bankAccount.accountNumber ?? "512"})`, report.bookBalance], ["Écart", report.difference]].map(([label, value]) => (
              <Card key={label}><CardContent className="py-4"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="tabular mt-1 font-display text-2xl font-bold">{formatCurrency(value, { currency })}</p></CardContent></Card>
            ))}
          </div>
          {balanced ? (
            <Alert variant="success">
              <CheckCircle2Icon />
              <AlertTitle>Comptes rapprochés au {formatDate(date)}</AlertTitle>
              <AlertDescription>Le compte {report.bankAccount.accountNumber} reflète exactement les opérations bancaires importées (brouillard compris).</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertTitle>Écart de {formatCurrency(report.difference, { currency })}</AlertTitle>
              <AlertDescription>Les éléments ci-dessous l'expliquent. Si aucun n'apparaît, lancez « Recalculer les écritures automatiques » depuis la vue d'ensemble.</AlertDescription>
            </Alert>
          )}
          {report.missingEntries.length > 0 || report.manualEntries.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {report.missingEntries.length > 0 ? (
                <Card>
                  <CardHeader><CardTitle>Opérations bancaires sans écriture</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="divide-y text-sm">
                      {report.missingEntries.map((m) => <li key={m.id} className="flex justify-between gap-3 py-2"><Link href={`/app/banque/operations/${m.id}`} className="truncate hover:text-primary hover:underline">{formatDate(m.date)} — {m.label}</Link><span className="tabular">{formatCurrency(m.amount, { currency })}</span></li>)}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
              {report.manualEntries.length > 0 ? (
                <Card>
                  <CardHeader><CardTitle>Écritures saisies sur le compte de banque</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="divide-y text-sm">
                      {report.manualEntries.map((m) => <li key={m.entryId} className="flex justify-between gap-3 py-2"><Link href={`/app/comptabilite/ecritures/${m.entryId}`} className="truncate hover:text-primary hover:underline">{formatDate(m.date)} — {m.label}{m.draft ? " (brouillard)" : ""}</Link><span className="tabular">{formatCurrency(m.amount, { currency })}</span></li>)}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
