import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, LockIcon, PlusIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listRecurringInvoices } from "@/server/modules/invoicing/recurring";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { RecurringTable } from "@/components/app/billing/recurring-view";
import { EmptyState } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Factures récurrentes" };

export default async function RecurringInvoicesPage() {
  const { access } = await requireCompany("invoices:read");
  const [items, available] = await Promise.all([listRecurringInvoices(access), companyHasModule(access.company.id, "invoicing-advanced")]);
  const canManage = access.permissions.has("invoices:issue") && available;
  const newButton = canManage ? (
    <Button asChild>
      <Link href="/app/factures/recurrentes/nouvelle"><PlusIcon /> Nouvelle récurrence</Link>
    </Button>
  ) : undefined;

  return (
    <>
      <Link href="/app/factures" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Toutes les factures
      </Link>
      <PageHeader title="Factures récurrentes" description="Abonnements et contrats facturés à intervalle régulier, générés automatiquement chaque jour." actions={newButton} />
      {!available ? (
        <Alert variant="warning" className="mb-6">
          <LockIcon />
          <AlertTitle>Fonctionnalité de la formule Pro</AlertTitle>
          <AlertDescription>Les factures récurrentes sont incluses à partir de la formule Pro.</AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="Aucune facture récurrente" description="Créez une récurrence pour générer vos factures d'abonnement ou de maintenance sans y penser." action={newButton} />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <RecurringTable companyId={access.company.id} items={items} canManage={canManage} currency={access.company.currency} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
