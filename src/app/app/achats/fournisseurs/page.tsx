import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { einvoicingAvailable } from "@/server/modules/einvoicing/service";
import { listSuppliers } from "@/server/modules/purchases/service";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { FilterTabs } from "@/components/app/billing/shared";
import { SuppliersPanel } from "@/components/app/purchases/purchases-view";
import { PurchasesTabs } from "@/components/app/purchases/tabs";

export const metadata: Metadata = { title: "Fournisseurs" };

type Props = { searchParams: Promise<{ status?: string }> };

export default async function SuppliersPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("purchases:read"), searchParams]);
  const archived = params.status === "archived";
  const suppliers = await listSuppliers(access, { archived });
  return (
    <>
      <PageHeader title="Achats" description="Vos fournisseurs et ce qui leur reste dû." />
      <PurchasesTabs current="fournisseurs" einvoicing={einvoicingAvailable()} />
      <div className="mb-4">
        <FilterTabs basePath="/app/achats/fournisseurs" current={archived ? "archived" : "all"} options={[{ value: "all", label: "Actifs" }, { value: "archived", label: "Archivés" }]} />
      </div>
      <Card>
        <CardContent className="py-4">
          <SuppliersPanel companyId={access.company.id} suppliers={suppliers} canWrite={access.permissions.has("purchases:write")} currency={access.company.currency} />
        </CardContent>
      </Card>
    </>
  );
}
