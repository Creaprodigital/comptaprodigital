import type { Metadata } from "next";
import { DownloadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { listProducts, listVatRates } from "@/server/modules/products/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { NewProductButton, ProductsTable } from "@/components/app/billing/products-view";
import { EmptyState, FilterTabs, Pagination, SearchForm } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Catalogue" };

type Props = { searchParams: Promise<{ q?: string; page?: string; status?: string }> };

export default async function CataloguePage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("products:read"), searchParams]);
  const archived = params.status === "archived";
  const page = Math.max(1, Number(params.page) || 1);
  const [result, vatRates] = await Promise.all([listProducts(access, { q: params.q?.slice(0, 100), page, archived }), listVatRates(access)]);
  const canWrite = access.permissions.has("products:write");
  const companyId = access.company.id;

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Vos produits et prestations, avec leur prix et leur taux de TVA."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/v1/companies/${companyId}/products/export`} download>
                <DownloadIcon /> Exporter (CSV)
              </a>
            </Button>
            {canWrite ? <NewProductButton companyId={companyId} vatRates={vatRates} /> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs basePath="/app/catalogue" current={archived ? "archived" : "all"} query={params.q} options={[{ value: "all", label: "Actifs" }, { value: "archived", label: "Archivés" }]} />
        <SearchForm action="/app/catalogue" query={params.q} placeholder="Rechercher un article" hidden={{ status: archived ? "archived" : undefined }} />
      </div>
      {result.items.length === 0 ? (
        <EmptyState
          title={params.q ? "Aucun article ne correspond à cette recherche" : archived ? "Aucun article archivé" : "Votre catalogue est vide"}
          description={params.q || archived ? "Modifiez votre recherche ou vos filtres." : "Ajoutez vos prestations et produits pour les insérer en un clic dans vos documents."}
          action={!params.q && !archived && canWrite ? <NewProductButton companyId={companyId} vatRates={vatRates} /> : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <ProductsTable companyId={companyId} products={result.items} vatRates={vatRates} canWrite={canWrite} currency={access.company.currency} />
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/catalogue" page={result.page} pageSize={result.pageSize} total={result.total} params={{ q: params.q, status: archived ? "archived" : undefined }} />
    </>
  );
}
