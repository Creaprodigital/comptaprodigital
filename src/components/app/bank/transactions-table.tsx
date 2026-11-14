"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangleIcon, CopyIcon, Loader2Icon, PaperclipIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { BankAccountView } from "@/server/modules/bank/accounts";
import type { CategoryView } from "@/server/modules/bank/categories";
import type { TransactionView } from "@/server/modules/bank/transactions";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { requiresReceipt } from "@/lib/bank";
import { formatDate } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategorySelect, VatRateSelect } from "@/components/app/bank/category-select";
import { Amount, CategoryChip, TransactionStatusBadge } from "@/components/app/bank/shared";

/** Liste des opérations, avec sélection multiple pour catégoriser en une fois. */
export function TransactionsTable({ companyId, transactions, categories, canWrite, showAccount }: { companyId: string; transactions: TransactionView[]; categories: CategoryView[]; canWrite: boolean; showAccount: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryId, setCategoryId] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setSelected(new Set()));

  // Seules les opérations encore affichées comptent (la liste change après un filtre ou une actualisation).
  const ids = transactions.map((t) => t.id).filter((id) => selected.has(id));
  const allSelected = transactions.length > 0 && ids.length === transactions.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function categorize() {
    if (!categoryId) {
      toast.error("Choisissez une catégorie.");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ updated: number }>(`/companies/${companyId}/bank/transactions/bulk-categorize`, { method: "POST", body: { ids, categoryId, vatRate } });
      toast.success(`${result.updated} opération${result.updated > 1 ? "s" : ""} catégorisée${result.updated > 1 ? "s" : ""}.`);
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {canWrite && ids.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border bg-accent px-3 py-2" role="region" aria-label="Actions sur la sélection">
          <p className="mr-auto text-sm font-medium">
            {ids.length} opération{ids.length > 1 ? "s" : ""} sélectionnée{ids.length > 1 ? "s" : ""}
          </p>
          <CategorySelect categories={categories} emptyLabel="Catégorie…" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie à appliquer" className="h-9 w-56" />
          <VatRateSelect value={vatRate} onChange={(e) => setVatRate(e.target.value)} aria-label="Taux de TVA à appliquer" emptyLabel="TVA inchangée" className="h-9 w-40" />
          <Button size="sm" onClick={categorize} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Catégoriser la sélection
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {canWrite ? (
              <TableHead className="w-8">
                <input type="checkbox" className="size-4 accent-primary" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(transactions.map((t) => t.id)))} aria-label="Tout sélectionner" />
              </TableHead>
            ) : null}
            <TableHead>Date</TableHead>
            <TableHead>Opération</TableHead>
            <TableHead className="hidden lg:table-cell">Catégorie</TableHead>
            <TableHead className="hidden sm:table-cell">Statut</TableHead>
            <TableHead className="text-right">Montant</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id} data-state={selected.has(transaction.id) ? "selected" : undefined}>
              {canWrite ? (
                <TableCell>
                  <input type="checkbox" className="size-4 accent-primary" checked={selected.has(transaction.id)} onChange={() => toggle(transaction.id)} aria-label={`Sélectionner ${transaction.label}`} />
                </TableCell>
              ) : null}
              <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(transaction.date)}</TableCell>
              <TableCell className="max-w-[22rem]">
                <Link href={`/app/banque/operations/${transaction.id}`} className="block truncate font-medium hover:text-primary hover:underline">
                  {transaction.label}
                </Link>
                <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                  {showAccount ? <span>{transaction.account.name}</span> : null}
                  <span className="lg:hidden">{transaction.category?.name ?? "Sans catégorie"}</span>
                  {transaction.documentCount > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <PaperclipIcon className="size-3" aria-hidden="true" /> {transaction.documentCount} justificatif{transaction.documentCount > 1 ? "s" : ""}
                    </span>
                  ) : null}
                  {requiresReceipt(transaction) ? (
                    <span className="inline-flex items-center gap-1 text-warning-foreground">
                      <AlertTriangleIcon className="size-3" aria-hidden="true" /> Justificatif manquant
                    </span>
                  ) : null}
                  {transaction.isDuplicateSuspect ? (
                    <span className="inline-flex items-center gap-1 text-destructive-foreground">
                      <CopyIcon className="size-3" aria-hidden="true" /> Doublon possible
                    </span>
                  ) : null}
                </p>
              </TableCell>
              <TableCell className="hidden max-w-[14rem] lg:table-cell">
                <CategoryChip category={transaction.category} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <TransactionStatusBadge status={transaction.status} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={transaction.amount} currency={transaction.currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

/** Saisie manuelle d'une opération (espèces, opération absente d'un relevé…). */
export function NewTransactionButton({ companyId, accounts, categories, today }: { companyId: string; accounts: BankAccountView[]; categories: CategoryView[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useResetOnHide(() => setOpen(false));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/companies/${companyId}/bank/transactions`, { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast.success("Opération enregistrée.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon /> Saisir une opération
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Saisir une opération</DialogTitle>
            <DialogDescription>Pour une opération absente de vos relevés. Les opérations d'un relevé s'ajoutent par l'import.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="tx-account" label="Compte" error={errors.bankAccountId} required>
                <NativeSelect name="bankAccountId" required defaultValue={accounts[0]?.id}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="tx-date" label="Date" error={errors.date} required>
                <Input name="date" type="date" required defaultValue={today} max={today} />
              </Field>
              <Field id="tx-label" label="Libellé" error={errors.label} required className="sm:col-span-2">
                <Input name="label" required maxLength={255} />
              </Field>
              <Field id="tx-direction" label="Sens" error={errors.direction} required>
                <NativeSelect name="direction" defaultValue="OUT">
                  <option value="OUT">Décaissement (sortie)</option>
                  <option value="IN">Encaissement (entrée)</option>
                </NativeSelect>
              </Field>
              <Field id="tx-amount" label="Montant TTC" error={errors.amount} required>
                <Input name="amount" inputMode="decimal" required placeholder="0,00" />
              </Field>
              <Field id="tx-category" label="Catégorie" error={errors.categoryId}>
                <CategorySelect name="categoryId" categories={categories} emptyLabel="À catégoriser plus tard" defaultValue="" />
              </Field>
              <Field id="tx-vat" label="TVA" error={errors.vatRate}>
                <VatRateSelect name="vatRate" defaultValue="" />
              </Field>
              <Field id="tx-notes" label="Note" error={errors.notes} className="sm:col-span-2">
                <Textarea name="notes" rows={2} className="min-h-16" />
              </Field>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Enregistrer l'opération
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
