import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { THIRD_PARTY_ACCOUNTS, thirdPartyBalances, thirdPartyLines } from "@/server/modules/accounting/reports";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, FilterTabs } from "@/components/app/billing/shared";
import { AccountingTabs, Amount } from "@/components/app/accounting/shared";
import { AutoLetterButton, LetteringTable } from "@/components/app/accounting/lettering";

export const metadata: Metadata = { title: "Clients et fournisseurs" };

type Props = { searchParams: Promise<{ status?: string; compte?: string; aux?: string }> };

export default async function ThirdPartiesPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const kind = params.status === "suppliers" ? "suppliers" : "customers";
  const balances = await thirdPartyBalances(access, kind);
  const allowed: readonly string[] = THIRD_PARTY_ACCOUNTS[kind];
  const selectedAccount = params.compte && allowed.includes(params.compte) ? params.compte : null;
  const selected = selectedAccount ? balances.find((b) => b.accountNumber === selectedAccount && (b.auxiliaryNumber ?? "") === (params.aux ?? "")) : null;
  const lines = selected ? await thirdPartyLines(access, selected.accountNumber, selected.auxiliaryNumber) : [];
  const canWrite = access.permissions.has("accounting:write");
  const currency = access.company.currency;

  return (
    <>
      <PageHeader title="Clients et fournisseurs" description="Soldes par tiers (exercices ouverts) et lettrage des factures avec leurs règlements." actions={canWrite ? <AutoLetterButton companyId={access.company.id} /> : undefined} />
      <AccountingTabs current="tiers" />
      <div className="mb-4">
        <FilterTabs basePath="/app/comptabilite/tiers" current={kind === "customers" ? "all" : "suppliers"} options={[{ value: "all", label: "Clients" }, { value: "suppliers", label: "Fournisseurs" }]} />
      </div>
      {balances.length === 0 ? (
        <EmptyState title={kind === "customers" ? "Aucun compte client mouvementé" : "Aucun compte fournisseur mouvementé"} description="Les comptes de tiers se remplissent avec les factures, les achats et leurs règlements." />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.6fr]">
          <Card>
            <CardContent className="px-2 py-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tiers</TableHead><TableHead className="text-right">Solde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => {
                    const active = selected === b;
                    const href = `/app/comptabilite/tiers?${new URLSearchParams({ ...(kind === "suppliers" ? { status: "suppliers" } : {}), compte: b.accountNumber, aux: b.auxiliaryNumber ?? "" })}`;
                    return (
                      <TableRow key={`${b.accountNumber}-${b.auxiliaryNumber}`} className={cn(active && "bg-accent")}>
                        <TableCell>
                          <Link href={href} className="font-medium hover:text-primary hover:underline">{b.auxiliaryLabel}</Link>
                          <p className="tabular text-xs text-muted-foreground">{b.accountNumber}{b.auxiliaryNumber ? ` · ${b.auxiliaryNumber}` : ""}{b.unletteredLines > 0 ? ` · ${b.unletteredLines} ligne${b.unletteredLines > 1 ? "s" : ""} non lettrée${b.unletteredLines > 1 ? "s" : ""}` : ""}</p>
                        </TableCell>
                        <TableCell className="text-right"><Amount value={b.balance} currency={currency} strong /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {selected ? (
            <Card>
              <CardHeader><CardTitle>{selected.auxiliaryLabel} — compte {selected.accountNumber}</CardTitle></CardHeader>
              <CardContent className="px-2 pb-2 sm:px-4">
                <LetteringTable companyId={access.company.id} accountNumber={selected.accountNumber} lines={lines} canWrite={canWrite} currency={currency} />
              </CardContent>
            </Card>
          ) : (
            <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">Choisissez un tiers pour voir ses écritures et les lettrer.</p>
          )}
        </div>
      )}
    </>
  );
}
