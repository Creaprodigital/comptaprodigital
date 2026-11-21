import type { Metadata } from "next";
import { DownloadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { einvoicingAvailable } from "@/server/modules/einvoicing/service";
import { listCategories } from "@/server/modules/bank/categories";
import { listPurchases, listSuppliers } from "@/server/modules/purchases/service";
import { todayInParis } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, FilterTabs, Pagination, SearchForm } from "@/components/app/billing/shared";
import { NewPurchaseButton, PurchasesTable } from "@/components/app/purchases/purchases-view";
import { PurchasesTabs } from "@/components/app/purchases/tabs";

export const metadata: Metadata = { title: "Achats" };

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string; fournisseur?: string }> };
const STATUSES = ["TO_PAY", "overdue", "PAID", "CANCELLED"] as const;

export default async function PurchasesPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("purchases:read"), searchParams]);
  const companyId = access.company.id;
  const status = STATUSES.find((s) => s === params.status);
  const supplierId = params.fournisseur?.slice(0, 40) || undefined;
  const [result, suppliers, categories] = await Promise.all([
    listPurchases(access, { q: params.q?.slice(0, 100), status, supplierId, page: Math.max(1, Number(params.page) || 1) }),
    listSuppliers(access),
    listCategories(companyId),
  ]);
  const canWrite = access.permissions.has("purchases:write");
  const currency = access.company.currency;
  const supplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  const newButton = canWrite ? <NewPurchaseButton companyId={companyId} suppliers={suppliers} categories={categories} today={todayInParis()} /> : undefined;

  return (
    <>
      <PageHeader
        title="Achats"
        description={result.summary.toPayCount > 0 ? `${result.summary.toPayCount} facture${result.summary.toPayCount > 1 ? "s" : ""} à payer pour ${formatCurrency(result.summary.toPayAmount, { currency })}.` : "Factures de vos fournisseurs : charges, TVA déductible et règlements."}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/v1/companies/${companyId}/purchases/export`} download><DownloadIcon /> Exporter (CSV)</a>
            </Button>
            {newButton}
          </>
        }
      />
      <PurchasesTabs current="factures" einvoicing={einvoicingAvailable()} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs basePath="/app/achats" current={status ?? "all"} query={params.q} options={[{ value: "all", label: "Toutes" }, { value: "TO_PAY", label: "À payer" }, { value: "overdue", label: "En retard" }, { value: "PAID", label: "Payées" }, { value: "CANCELLED", label: "Annulées" }]} />
        <SearchForm action="/app/achats" query={params.q} placeholder="Fournisseur, numéro ou objet" hidden={{ status }} />
      </div>
      {supplier ? <p className="mb-3 text-sm text-muted-foreground">Fournisseur : <span className="font-medium text-foreground">{supplier.name}</span></p> : null}
      {result.items.length === 0 ? (
        <EmptyState
          title={params.q || status || supplier ? "Aucune facture d'achat ne correspond" : "Aucune facture d'achat"}
          description={params.q || status || supplier ? "Modifiez la recherche ou les filtres." : "Saisissez les factures de vos fournisseurs pour suivre ce que vous devez et votre TVA déductible."}
          action={!params.q && !status ? newButton : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <PurchasesTable purchases={result.items} currency={currency} />
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/achats" page={result.page} pageSize={result.pageSize} total={result.total} params={{ q: params.q, status, fournisseur: supplierId }} />
    </>
  );
}
