import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { listCategories } from "@/server/modules/bank/categories";
import { einvoicingAvailable, listIncomingInvoices } from "@/server/modules/einvoicing/service";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/billing/shared";
import { PurchasesTabs } from "@/components/app/purchases/tabs";
import { IncomingList, ReceptionToggle } from "@/components/app/einvoicing/einvoicing-view";

export const metadata: Metadata = { title: "Factures reçues" };

/** Factures électroniques reçues par la plateforme agréée (page absente tant qu'aucune plateforme n'est raccordée). */
export default async function IncomingInvoicesPage() {
  const { access } = await requireCompany("purchases:read");
  if (!einvoicingAvailable()) notFound();
  const companyId = access.company.id;
  const [items, categories] = await Promise.all([listIncomingInvoices(access), listCategories(companyId)]);
  const active = access.company.einvoicingActivatedAt !== null;

  return (
    <>
      <PageHeader title="Achats" description="Factures électroniques de vos fournisseurs, reçues par la plateforme agréée." />
      <PurchasesTabs current="recues" einvoicing />
      <ReceptionToggle companyId={companyId} active={active} canManage={access.permissions.has("company:update")} />
      {items.length === 0 ? (
        <EmptyState title="Aucune facture reçue" description={active ? "Les factures électroniques de vos fournisseurs apparaîtront ici dès leur réception." : "Activez la réception pour recevoir ici les factures de vos fournisseurs."} />
      ) : (
        <IncomingList companyId={companyId} items={items} categories={categories.filter((c) => c.kind !== "INCOME")} canWrite={access.permissions.has("purchases:write")} />
      )}
    </>
  );
}
