import type { Metadata } from "next";
import { DownloadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { listCustomers } from "@/server/modules/customers/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { CustomersTable, NewCustomerButton } from "@/components/app/billing/customers-view";
import { EmptyState, FilterTabs, Pagination, SearchForm } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Clients" };

type Props = { searchParams: Promise<{ q?: string; page?: string; status?: string }> };

export default async function CustomersPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("customers:read"), searchParams]);
  const archived = params.status === "archived";
  const page = Math.max(1, Number(params.page) || 1);
  const result = await listCustomers(access, { q: params.q?.slice(0, 100), page, archived });
  const canWrite = access.permissions.has("customers:write");
  const companyId = access.company.id;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Les destinataires de vos devis et factures."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/v1/companies/${companyId}/customers/export`} download>
                <DownloadIcon /> Exporter (CSV)
              </a>
            </Button>
            {canWrite ? <NewCustomerButton companyId={companyId} /> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs basePath="/app/clients" current={archived ? "archived" : "all"} query={params.q} options={[{ value: "all", label: "Actifs" }, { value: "archived", label: "Archivés" }]} />
        <SearchForm action="/app/clients" query={params.q} placeholder="Rechercher un client" hidden={{ status: archived ? "archived" : undefined }} />
      </div>
      {result.items.length === 0 ? (
        <EmptyState
          title={params.q ? "Aucun client ne correspond à cette recherche" : archived ? "Aucun client archivé" : "Aucun client pour l'instant"}
          description={params.q || archived ? "Modifiez votre recherche ou vos filtres." : "Créez votre premier client pour établir un devis ou une facture."}
          action={!params.q && !archived && canWrite ? <NewCustomerButton companyId={companyId} /> : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <CustomersTable companyId={companyId} customers={result.items} canWrite={canWrite} currency={access.company.currency} />
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/clients" page={result.page} pageSize={result.pageSize} total={result.total} params={{ q: params.q, status: archived ? "archived" : undefined }} />
    </>
  );
}
