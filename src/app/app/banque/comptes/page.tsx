import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listBankAccounts } from "@/server/modules/bank/accounts";
import { getBankDataProvider } from "@/server/modules/bank/provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { AccountCards, NewAccountButton } from "@/components/app/bank/accounts-view";
import { BankTabs } from "@/components/app/bank/shared";
import { EmptyState } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Comptes bancaires" };

export default async function BankAccountsPage() {
  const { access } = await requireCompany("bank:read");
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const accounts = await listBankAccounts(access, { includeInactive: true });
  const canWrite = access.permissions.has("bank:write");
  const newButton = canWrite ? <NewAccountButton companyId={access.company.id} /> : undefined;

  return (
    <>
      <PageHeader title="Comptes bancaires" description="Les comptes de l'entreprise et leur solde, calculé à partir du solde d'ouverture et des opérations." actions={newButton} />
      <BankTabs current="comptes" />
      {accounts.length === 0 ? (
        <EmptyState title="Aucun compte bancaire" description="Ajoutez le compte professionnel de l'entreprise pour y importer vos relevés." action={newButton} />
      ) : (
        <AccountCards companyId={access.company.id} accounts={accounts} canWrite={canWrite} />
      )}
      {getBankDataProvider() === null ? (
        <Alert className="mt-6">
          <ShieldCheckIcon />
          <AlertTitle>Alimentation des comptes par import de relevés</AlertTitle>
          <AlertDescription>
            Les opérations sont ajoutées en important les relevés téléchargés depuis votre banque (CSV, OFX ou camt.053). La synchronisation automatique passera par un prestataire agréé, sur son propre parcours
            sécurisé : ComptaPro Digital ne demande et ne conserve jamais vos identifiants bancaires. Elle n'est pas encore disponible.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
