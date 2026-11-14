import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listBankAccounts } from "@/server/modules/bank/accounts";
import { listCategories } from "@/server/modules/bank/categories";
import { listTransactions } from "@/server/modules/bank/transactions";
import { TRANSACTION_STATUS_LABELS } from "@/lib/bank";
import { isIsoDate, todayInParis } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { sum, toMoneyString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { CategorySelect } from "@/components/app/bank/category-select";
import { BankTabs, ModuleLocked } from "@/components/app/bank/shared";
import { NewTransactionButton, TransactionsTable } from "@/components/app/bank/transactions-table";
import { EmptyState, Pagination } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Banque" };

type Search = { q?: string; compte?: string; statut?: string; sens?: string; categorie?: string; filtre?: string; du?: string; au?: string; page?: string };
type Props = { searchParams: Promise<Search> };

const pick = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined);

export default async function BankPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("bank:read"), searchParams]);
  if (!(await companyHasModule(access.company.id, "bank"))) {
    return (
      <>
        <PageHeader title="Banque" description="Suivi des comptes, import de relevés et rapprochement." />
        <ModuleLocked title="Le suivi bancaire fait partie de la formule Pro" description="Importez vos relevés, catégorisez vos opérations et rapprochez vos encaissements de vos factures en passant à la formule Pro." />
      </>
    );
  }

  const companyId = access.company.id;
  const currency = access.company.currency;
  const canWrite = access.permissions.has("bank:write");
  const query = {
    q: params.q?.slice(0, 100) || undefined,
    accountId: params.compte?.slice(0, 40) || undefined,
    status: pick(params.statut, ["TO_REVIEW", "CATEGORIZED", "RECONCILED"] as const),
    direction: pick(params.sens, ["IN", "OUT"] as const),
    categoryId: params.categorie?.slice(0, 40) || undefined,
    flag: pick(params.filtre, ["unjustified", "duplicates"] as const),
    from: params.du && isIsoDate(params.du) ? params.du : undefined,
    to: params.au && isIsoDate(params.au) ? params.au : undefined,
    page: Math.max(1, Number(params.page) || 1),
  };
  const [accounts, categories, result] = await Promise.all([listBankAccounts(access), listCategories(companyId), listTransactions(access, query)]);
  const filtered = Boolean(query.q || query.accountId || query.status || query.direction || query.categoryId || query.flag || query.from || query.to);
  const urlParams = { q: query.q, compte: query.accountId, statut: query.status, sens: query.direction, categorie: query.categoryId, filtre: query.flag, du: query.from, au: query.to };
  const exportQuery = new URLSearchParams(Object.entries({ q: query.q, accountId: query.accountId, status: query.status, direction: query.direction, categoryId: query.categoryId, flag: query.flag, from: query.from, to: query.to }).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const totalBalance = toMoneyString(sum(accounts.map((account) => account.balance)));

  const shortcuts = [
    { label: "À traiter", count: result.summary.toReview, href: "/app/banque?statut=TO_REVIEW", active: query.status === "TO_REVIEW" },
    { label: "Sans justificatif", count: result.summary.unjustified, href: "/app/banque?filtre=unjustified", active: query.flag === "unjustified" },
    { label: "Doublons possibles", count: result.summary.duplicates, href: "/app/banque?filtre=duplicates", active: query.flag === "duplicates" },
  ];

  return (
    <>
      <PageHeader
        title="Banque"
        description="Vos opérations bancaires, à catégoriser, justifier et rapprocher de vos factures."
        actions={
          accounts.length > 0 ? (
            <>
              <Button asChild variant="outline">
                <a href={`/api/v1/companies/${companyId}/bank/transactions/export${exportQuery.size ? `?${exportQuery}` : ""}`} download>
                  <DownloadIcon /> Exporter (CSV)
                </a>
              </Button>
              {canWrite ? <NewTransactionButton companyId={companyId} accounts={accounts} categories={categories} today={todayInParis()} /> : null}
              {canWrite ? (
                <Button asChild>
                  <Link href="/app/banque/import"><UploadIcon /> Importer un relevé</Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <BankTabs current="operations" />

      {accounts.length === 0 ? (
        <EmptyState
          title="Aucun compte bancaire"
          description="Ajoutez votre compte professionnel, puis importez un relevé au format CSV, OFX ou camt.053 pour commencer le suivi."
          action={canWrite ? <Button asChild><Link href="/app/banque/comptes">Ajouter un compte</Link></Button> : undefined}
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Solde {accounts.length > 1 ? `des ${accounts.length} comptes` : `— ${accounts[0].name}`}</p>
                <p className="tabular mt-1 font-display text-2xl font-bold">{formatCurrency(totalBalance, { currency })}</p>
              </CardContent>
            </Card>
            {shortcuts.map((shortcut) => (
              <Link
                key={shortcut.label}
                href={shortcut.active ? "/app/banque" : shortcut.href}
                aria-current={shortcut.active ? "true" : undefined}
                className={cn("rounded-2xl border bg-card px-6 py-4 shadow-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring", shortcut.active && "border-primary bg-accent")}
              >
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{shortcut.label}</p>
                <p className="tabular mt-1 font-display text-2xl font-bold">{shortcut.count}</p>
              </Link>
            ))}
          </div>

          <form action="/app/banque" method="get" role="search" className="mb-4 grid gap-2 rounded-2xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
            {query.flag ? <input type="hidden" name="filtre" value={query.flag} /> : null}
            <Input name="q" type="search" defaultValue={query.q} placeholder="Libellé ou montant" aria-label="Rechercher un libellé ou un montant" />
            <NativeSelect name="compte" defaultValue={query.accountId ?? ""} aria-label="Compte">
              <option value="">Tous les comptes</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="statut" defaultValue={query.status ?? ""} aria-label="Statut">
              <option value="">Tous les statuts</option>
              {Object.entries(TRANSACTION_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="sens" defaultValue={query.direction ?? ""} aria-label="Sens">
              <option value="">Entrées et sorties</option>
              <option value="IN">Encaissements</option>
              <option value="OUT">Décaissements</option>
            </NativeSelect>
            <CategorySelect name="categorie" categories={categories} emptyLabel="Toutes les catégories" defaultValue={query.categoryId ?? ""} aria-label="Catégorie" />
            <Input name="du" type="date" defaultValue={query.from} aria-label="Du" />
            <Input name="au" type="date" defaultValue={query.to} aria-label="Au" />
            <div className="flex gap-2">
              <Button type="submit" variant="outline">Filtrer</Button>
              {filtered ? (
                <Button asChild variant="ghost">
                  <Link href="/app/banque">Effacer</Link>
                </Button>
              ) : null}
            </div>
          </form>

          {result.items.length === 0 ? (
            <EmptyState
              title={filtered ? "Aucune opération ne correspond à ces critères" : "Aucune opération pour l'instant"}
              description={filtered ? "Modifiez ou effacez les filtres." : "Importez un relevé bancaire ou saisissez une opération pour commencer."}
              action={!filtered && canWrite ? <Button asChild><Link href="/app/banque/import"><UploadIcon /> Importer un relevé</Link></Button> : undefined}
            />
          ) : (
            <Card>
              <CardContent className="px-2 py-2 sm:px-4">
                <TransactionsTable companyId={companyId} transactions={result.items} categories={categories} canWrite={canWrite} showAccount={accounts.length > 1 && !query.accountId} />
              </CardContent>
            </Card>
          )}
          {result.total > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {filtered ? "Sur cette sélection : " : "Au total : "}
              <span className="tabular font-medium text-foreground">{formatCurrency(result.totals.inflow, { currency })}</span> encaissés,{" "}
              <span className="tabular font-medium text-foreground">{formatCurrency(result.totals.outflow.replace("-", ""), { currency })}</span> décaissés.
            </p>
          ) : null}
          <Pagination basePath="/app/banque" page={result.page} pageSize={result.pageSize} total={result.total} params={urlParams} />
        </>
      )}
    </>
  );
}
