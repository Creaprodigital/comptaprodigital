"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Decimal from "decimal.js";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import type { CategoryView } from "@/server/modules/bank/categories";
import type { PurchaseView, SupplierView } from "@/server/modules/purchases/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CategorySelect } from "@/components/app/bank/category-select";

const parse = (value: string) => {
  const normalized = value.replace(/[\s  ]/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? new Decimal(normalized) : null;
};

/** Saisie ou modification d'une facture d'achat. */
export function PurchaseDialog({
  companyId,
  purchase,
  suppliers,
  categories,
  today,
  open,
  onOpenChange,
}: {
  companyId: string;
  purchase?: PurchaseView | null;
  suppliers: SupplierView[];
  categories: CategoryView[];
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [exclTax, setExclTax] = useState(purchase ? purchase.totalExclTax.replace(".", ",") : "");
  const [vat, setVat] = useState(purchase ? purchase.totalVat.replace(".", ",") : "");
  const [operationCategory, setOperationCategory] = useState(purchase?.operationCategory ?? "SERVICES");
  const total = parse(exclTax) && parse(vat || "0") ? parse(exclTax)!.plus(parse(vat || "0")!) : null;
  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE" || c.kind === "PAYROLL" || c.kind === "TAX" || c.kind === "OTHER");

  function applyRate(rate: string) {
    const base = parse(exclTax);
    if (base) setVat(base.times(rate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2).replace(".", ","));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { ...Object.fromEntries(form.entries()), supplierVatOnDebits: form.get("supplierVatOnDebits") === "on" };
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = purchase
        ? await api<PurchaseView>(`/companies/${companyId}/purchases/${purchase.id}`, { method: "PUT", body })
        : await api<PurchaseView>(`/companies/${companyId}/purchases`, { method: "POST", body });
      toast.success(purchase ? "Facture d'achat enregistrée." : "Facture d'achat ajoutée.");
      onOpenChange(false);
      if (purchase) router.refresh();
      else router.push(`/app/achats/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{purchase ? "Modifier la facture d'achat" : "Nouvelle facture d'achat"}</DialogTitle>
          <DialogDescription>Reportez les montants de la facture du fournisseur. Elle alimente le journal des achats et la TVA déductible.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={purchase?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="purchase-supplier" label="Fournisseur" error={errors.supplierId}>
              <NativeSelect name="supplierId" defaultValue={purchase?.supplier?.id ?? ""}>
                <option value="">Sans fournisseur identifié</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="purchase-reference" label="Numéro de la facture" error={errors.reference}>
              <Input name="reference" maxLength={100} defaultValue={purchase?.reference ?? ""} />
            </Field>
            <Field id="purchase-label" label="Objet" error={errors.label} required className="sm:col-span-2">
              <Input name="label" required maxLength={255} defaultValue={purchase?.label ?? ""} />
            </Field>
            <Field id="purchase-date" label="Date de la facture" error={errors.issueDate} required>
              <Input name="issueDate" type="date" required max={today} defaultValue={purchase?.issueDate ?? today} />
            </Field>
            <Field id="purchase-due" label="Échéance" error={errors.dueDate}>
              <Input name="dueDate" type="date" defaultValue={purchase?.dueDate ?? ""} />
            </Field>
            <Field id="purchase-category" label="Catégorie (compte de charge)" error={errors.categoryId} required>
              <CategorySelect name="categoryId" categories={expenseCategories} emptyLabel="Choisir…" required defaultValue={purchase?.category?.id ?? ""} />
            </Field>
            <Field id="purchase-nature" label="Nature" error={errors.operationCategory} hint={operationCategory === "GOODS" ? "TVA déductible dès la facture." : "TVA déductible au paiement, sauf option du fournisseur pour les débits."}>
              <NativeSelect name="operationCategory" value={operationCategory} onChange={(e) => setOperationCategory(e.target.value as typeof operationCategory)}>
                <option value="SERVICES">Prestation de services</option>
                <option value="GOODS">Achat de biens</option>
                <option value="MIXED">Mixte</option>
              </NativeSelect>
            </Field>
            <Field id="purchase-excl" label="Montant HT" error={errors.totalExclTax} required>
              <Input name="totalExclTax" inputMode="decimal" required value={exclTax} onChange={(e) => setExclTax(e.target.value)} placeholder="0,00" />
            </Field>
            <Field id="purchase-vat" label="TVA" error={errors.totalVat} hint={<span className="flex flex-wrap gap-2">{["20", "10", "5.5"].map((r) => <button key={r} type="button" className="underline-offset-2 hover:underline" onClick={() => applyRate(r)}>{r.replace(".", ",")} %</button>)}</span>}>
              <Input name="totalVat" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="0,00" />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="supplierVatOnDebits" className="mt-0.5 size-4 accent-primary" defaultChecked={purchase?.supplierVatOnDebits ?? false} />
              <span>La facture porte la mention « option pour le paiement de la taxe d'après les débits »</span>
            </label>
            <Field id="purchase-notes" label="Note" error={errors.notes} className="sm:col-span-2">
              <Textarea name="notes" rows={2} className="min-h-16" defaultValue={purchase?.notes ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <p className="mr-auto self-center text-sm text-muted-foreground">
              Total TTC : <span className="tabular font-semibold text-foreground">{total ? formatCurrency(total.toFixed(2)) : "—"}</span>
            </p>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {purchase ? "Enregistrer" : "Ajouter la facture"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
