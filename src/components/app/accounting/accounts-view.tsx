"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { AccountView } from "@/server/modules/accounting/chart";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Amount } from "@/components/app/accounting/shared";

function AccountDialog({ companyId, account, open, onOpenChange }: { companyId: string; account?: AccountView | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (account) await api(`/companies/${companyId}/accounting/accounts/${account.id}`, { method: "PATCH", body: { label: form.get("label"), isActive: form.get("isActive") === "on" } });
      else await api(`/companies/${companyId}/accounting/accounts`, { method: "POST", body: { number: form.get("number"), label: form.get("label") } });
      toast.success(account ? "Compte enregistré." : "Compte créé.");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? `Compte ${account.number}` : "Nouveau compte"}</DialogTitle>
          <DialogDescription>{account ? "Un compte désactivé n'est plus proposé à la saisie ; ses écritures sont conservées." : "Créez un sous-compte du plan comptable général (ex. 626100 Téléphone mobile)."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4" key={account?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          {!account ? <Field id="account-number" label="Numéro" error={errors.number} required><Input name="number" inputMode="numeric" required maxLength={10} /></Field> : null}
          <Field id="account-label" label="Intitulé" error={errors.label} required><Input name="label" required maxLength={191} defaultValue={account?.label ?? ""} /></Field>
          {account ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={account.isActive} className="size-4 accent-primary" /> Compte actif</label> : null}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}{account ? "Enregistrer" : "Créer le compte"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsTable({ companyId, accounts, canWrite, currency }: { companyId: string; accounts: AccountView[]; canWrite: boolean; currency: string }) {
  const [dialog, setDialog] = useState<{ account: AccountView | null } | null>(null);
  useResetOnHide(() => setDialog(null));
  return (
    <>
      {canWrite ? <Button className="mb-3" onClick={() => setDialog({ account: null })}><PlusIcon /> Nouveau compte</Button> : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent"><TableHead>Compte</TableHead><TableHead className="hidden sm:table-cell text-right">Lignes</TableHead><TableHead className="text-right">Solde</TableHead>{canWrite ? <TableHead className="text-right">Actions</TableHead> : null}</TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.id} className={a.isActive ? undefined : "text-muted-foreground"}>
              <TableCell>
                <span className="tabular font-medium">{a.number}</span> <span className="text-sm">{a.label}</span>
                {!a.isSystem ? <Badge variant="secondary" className="ml-2">Entreprise</Badge> : null}
                {!a.isActive ? <Badge variant="outline" className="ml-2">Désactivé</Badge> : null}
              </TableCell>
              <TableCell className="tabular hidden text-right sm:table-cell">{a.lineCount || "—"}</TableCell>
              <TableCell className="text-right"><Amount value={a.balance} currency={currency} /></TableCell>
              {canWrite ? <TableCell className="text-right"><Button variant="ghost" size="icon-sm" onClick={() => setDialog({ account: a })} aria-label={`Modifier le compte ${a.number}`}><PencilIcon /></Button></TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AccountDialog companyId={companyId} account={dialog?.account} open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} />
    </>
  );
}
