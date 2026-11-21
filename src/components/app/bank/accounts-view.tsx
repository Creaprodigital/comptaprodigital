"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { BankAccountView } from "@/server/modules/bank/accounts";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function AccountDialog({ companyId, account, open, onOpenChange }: { companyId: string; account?: BankAccountView | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (account) await api(`/companies/${companyId}/bank/accounts/${account.id}`, { method: "PUT", body });
      else await api(`/companies/${companyId}/bank/accounts`, { method: "POST", body });
      toast.success(account ? "Compte enregistré." : "Compte ajouté.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{account ? "Modifier le compte" : "Ajouter un compte bancaire"}</DialogTitle>
          <DialogDescription>Seules les coordonnées du compte sont enregistrées : aucun identifiant ni mot de passe de banque en ligne n'est demandé.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={account?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="account-name" label="Nom du compte" error={errors.name} required>
              <Input name="name" required maxLength={100} defaultValue={account?.name ?? ""} placeholder="Compte courant professionnel" />
            </Field>
            <Field id="account-bank" label="Banque" error={errors.bankName}>
              <Input name="bankName" maxLength={100} defaultValue={account?.bankName ?? ""} />
            </Field>
            <Field id="account-iban" label="IBAN" error={errors.iban} hint={account?.ibanMasked ? `Enregistré : ${account.ibanMasked}. Laissez vide pour le conserver.` : "Facultatif. Conservé chiffré."} className="sm:col-span-2">
              <Input name="iban" autoComplete="off" spellCheck={false} placeholder={account?.ibanMasked ? "" : "FR76 …"} />
            </Field>
            <Field id="account-bic" label="BIC" error={errors.bic}>
              <Input name="bic" maxLength={11} autoComplete="off" spellCheck={false} defaultValue={account?.bic ?? ""} />
            </Field>
            <div className="hidden sm:block" />
            <Field id="account-opening" label="Solde d'ouverture" error={errors.openingBalance} hint="Solde du compte à la date indiquée.">
              <Input name="openingBalance" inputMode="decimal" defaultValue={account ? account.openingBalance.replace(".", ",") : ""} placeholder="0,00" />
            </Field>
            <Field id="account-opening-date" label="Date du solde d'ouverture" error={errors.openingBalanceDate} hint="Les opérations antérieures n'entrent pas dans le solde.">
              <Input name="openingBalanceDate" type="date" defaultValue={account?.openingBalanceDate ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {account ? "Enregistrer" : "Ajouter le compte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAccountButton({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  useResetOnHide(() => setOpen(false));
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Ajouter un compte
      </Button>
      <AccountDialog companyId={companyId} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function AccountCards({ companyId, accounts, canWrite }: { companyId: string; accounts: BankAccountView[]; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BankAccountView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => setEditing(null));

  async function run(account: BankAccountView, action: () => Promise<unknown>, message: string) {
    setBusy(account.id);
    try {
      await action();
      toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id} className={account.isActive ? undefined : "opacity-70"}>
            <CardContent className="grid gap-3 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-semibold">{account.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[account.bankName, account.ibanMasked ? `IBAN ${account.ibanMasked}` : null].filter(Boolean).join(" · ") || "Coordonnées non renseignées"}
                  </p>
                </div>
                {!account.isActive ? <Badge variant="outline">Archivé</Badge> : account.provider === "AGGREGATOR" ? <Badge variant="success">Synchronisé</Badge> : null}
              </div>
              <div>
                <p className="tabular font-display text-2xl font-bold">{formatCurrency(account.balance, { currency: account.currency })}</p>
                <p className="text-xs text-muted-foreground">
                  {account.transactionCount === 0
                    ? "Aucune opération"
                    : `${account.transactionCount} opération${account.transactionCount > 1 ? "s" : ""} · dernière le ${formatDate(account.lastTransactionDate!)}`}
                  {account.toReviewCount > 0 ? ` · ${account.toReviewCount} à traiter` : ""}
                </p>
                {account.providerBalance !== null && account.providerBalance !== account.balance ? (
                  <p className="mt-1 text-xs text-warning-foreground">
                    Solde communiqué par la banque : {formatCurrency(account.providerBalance, { currency: account.currency })}. Vérifiez le solde d'ouverture et les opérations antérieures à la connexion.
                  </p>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" onClick={() => setEditing(account)}>
                    <PencilIcon /> Modifier
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === account.id}
                    onClick={() => run(account, () => api(`/companies/${companyId}/bank/accounts/${account.id}/archive`, { method: "POST", body: { archived: account.isActive } }), account.isActive ? "Compte archivé." : "Compte réactivé.")}
                  >
                    {account.isActive ? <ArchiveIcon /> : <ArchiveRestoreIcon />} {account.isActive ? "Archiver" : "Réactiver"}
                  </Button>
                  {account.transactionCount === 0 ? (
                    <Button variant="ghost" size="sm" disabled={busy === account.id} onClick={() => run(account, () => api(`/companies/${companyId}/bank/accounts/${account.id}`, { method: "DELETE" }), "Compte supprimé.")}>
                      <Trash2Icon /> Supprimer
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <AccountDialog companyId={companyId} account={editing} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  );
}
