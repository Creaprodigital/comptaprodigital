import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listBankAccounts } from "@/server/modules/bank/accounts";
import { bankSyncAvailable, listBankConnections } from "@/server/modules/bank/connections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { AccountCards, NewAccountButton } from "@/components/app/bank/accounts-view";
import { BankConnections } from "@/components/app/bank/connections-view";
import { BankTabs } from "@/components/app/bank/shared";
import { EmptyState } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Comptes bancaires" };

const CONNECT_MESSAGES: Record<string, { tone: "success" | "info" | "warning"; text: string }> = {
  ok: { tone: "success", text: "Banque connectée : les opérations disponibles ont été récupérées. L'historique complet arrive dans les minutes qui suivent." },
  "synchro-differee": { tone: "info", text: "Banque connectée. La première synchronisation n'a pas abouti ; elle sera relancée automatiquement." },
  annulee: { tone: "info", text: "Connexion bancaire interrompue : aucune banque n'a été ajoutée." },
  expiree: { tone: "warning", text: "Le parcours de connexion a expiré : relancez-le depuis cette page." },
  invalide: { tone: "warning", text: "Ce retour de connexion bancaire n'a pas pu être vérifié : relancez la connexion depuis cette page." },
  erreur: { tone: "warning", text: "Le prestataire bancaire n'a pas répondu : réessayez dans quelques minutes." },
};

type Props = { searchParams: Promise<{ connexion?: string }> };

export default async function BankAccountsPage({ searchParams }: Props) {
  const [{ access }, { connexion }] = await Promise.all([requireCompany("bank:read"), searchParams]);
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const syncAvailable = bankSyncAvailable();
  const [accounts, connections] = await Promise.all([listBankAccounts(access, { includeInactive: true }), syncAvailable ? listBankConnections(access) : []]);
  const message = connexion ? CONNECT_MESSAGES[connexion] : undefined;
  const canWrite = access.permissions.has("bank:write");
  const newButton = canWrite ? <NewAccountButton companyId={access.company.id} /> : undefined;

  return (
    <>
      <PageHeader title="Comptes bancaires" description="Les comptes de l'entreprise et leur solde, calculé à partir du solde d'ouverture et des opérations." actions={newButton} />
      <BankTabs current="comptes" />
      {message ? (
        <Alert className={message.tone === "warning" ? "mb-6 border-warning/40 bg-warning-soft" : message.tone === "success" ? "mb-6 border-success/40 bg-success-soft" : "mb-6"}>
          <ShieldCheckIcon />
          <AlertDescription className="text-foreground">{message.text}</AlertDescription>
        </Alert>
      ) : null}
      {accounts.length === 0 ? (
        <EmptyState title="Aucun compte bancaire" description="Ajoutez le compte professionnel de l'entreprise pour y importer vos relevés." action={newButton} />
      ) : (
        <AccountCards companyId={access.company.id} accounts={accounts} canWrite={canWrite} />
      )}
      {syncAvailable ? <BankConnections companyId={access.company.id} connections={connections} canWrite={canWrite} /> : null}
      {!syncAvailable ? (
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
