import type { Metadata } from "next";
import { EyeIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { getBillingSettings } from "@/server/modules/invoicing/settings";
import { listVatRates } from "@/server/modules/products/service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { BillingSettingsForm } from "@/components/app/billing/billing-settings-form";

export const metadata: Metadata = { title: "Paramètres de facturation" };

export default async function BillingSettingsPage() {
  const { access } = await requireCompany("company:read");
  const [settings, vatRates] = await Promise.all([getBillingSettings(access), listVatRates(access)]);
  const canEdit = access.permissions.has("company:update");
  return (
    <>
      <PageHeader title="Paramètres de facturation" description="Numérotation, conditions de règlement, mentions, logo, taux de TVA et relances." />
      {!canEdit ? (
        <Alert className="mb-6">
          <EyeIcon />
          <AlertDescription className="text-foreground">Votre rôle permet de consulter ces paramètres, mais pas de les modifier.</AlertDescription>
        </Alert>
      ) : null}
      <BillingSettingsForm companyId={access.company.id} settings={settings} vatRates={vatRates} canEdit={canEdit} franchise={access.company.vatRegime === "FRANCHISE"} />
    </>
  );
}
