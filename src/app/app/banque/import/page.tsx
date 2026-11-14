import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listBankAccounts } from "@/server/modules/bank/accounts";
import { listImports } from "@/server/modules/bank/imports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { ImportsHistory, ImportWizard } from "@/components/app/bank/import-wizard";
import { BankTabs } from "@/components/app/bank/shared";
import { EmptyState } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Import de relevés" };

export default async function BankImportPage() {
  const { access } = await requireCompany("bank:read");
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const canWrite = access.permissions.has("bank:write");
  const [accounts, imports] = await Promise.all([listBankAccounts(access), listImports(access)]);

  return (
    <>
      <PageHeader title="Import de relevés" description="Ajoutez les opérations de vos relevés bancaires. Les opérations déjà présentes sont reconnues et ignorées." />
      <BankTabs current="import" />
      {!canWrite ? (
        <EmptyState title="Import réservé" description="Votre rôle permet de consulter les opérations, mais pas d'importer de relevé." />
      ) : accounts.length === 0 ? (
        <EmptyState title="Ajoutez d'abord un compte bancaire" description="Un relevé s'importe sur un compte de l'entreprise." action={<Button asChild><Link href="/app/banque/comptes">Ajouter un compte</Link></Button>} />
      ) : (
        <ImportWizard companyId={access.company.id} accounts={accounts} />
      )}
      {imports.length > 0 ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Imports précédents</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 sm:px-4">
            <ImportsHistory companyId={access.company.id} imports={imports} canWrite={canWrite} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
