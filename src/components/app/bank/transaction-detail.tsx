"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Decimal from "decimal.js";
import { CheckIcon, Loader2Icon, Trash2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import type { CategoryView } from "@/server/modules/bank/categories";
import type { ReconciliationSuggestions } from "@/server/modules/bank/reconciliation";
import type { TransactionPaymentView, TransactionView } from "@/server/modules/bank/transactions";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CategorySelect, VatRateSelect } from "@/components/app/bank/category-select";

/** Catégorie, TVA, libellé et note d'une opération. La date et le montant ne se modifient que pour une saisie manuelle. */
export function TransactionForm({ companyId, transaction, categories, canWrite, today }: { companyId: string; transaction: TransactionView; categories: CategoryView[]; canWrite: boolean; today: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Une catégorie désactivée reste affichée sur les opérations qui la portent.
  const options = transaction.category && !categories.some((c) => c.id === transaction.category!.id) ? [...categories, { ...transaction.category, kind: transaction.category.kind as CategoryView["kind"], accountNumber: null, system: false, isActive: false }] : categories;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      label: form.get("label"),
      notes: String(form.get("notes") ?? "") || null,
      categoryId: String(form.get("categoryId") ?? "") || null,
      vatRate: String(form.get("vatRate") ?? "") || null,
    };
    if (transaction.manual) Object.assign(body, { date: form.get("date"), amount: form.get("amount"), direction: form.get("direction") });
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/companies/${companyId}/bank/transactions/${transaction.id}`, { method: "PATCH", body });
      toast.success("Opération enregistrée.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
      <fieldset disabled={!canWrite || pending} className="grid gap-4 sm:grid-cols-2">
        <Field id="detail-label" label="Libellé" error={errors.label} required className="sm:col-span-2" hint={transaction.rawLabel && transaction.rawLabel !== transaction.label ? `Libellé d'origine : ${transaction.rawLabel}` : undefined}>
          <Input name="label" required maxLength={255} defaultValue={transaction.label} />
        </Field>
        {transaction.manual ? (
          <>
            <Field id="detail-date" label="Date" error={errors.date} required>
              <Input name="date" type="date" required max={today} defaultValue={transaction.date} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="detail-direction" label="Sens" error={errors.direction}>
                <NativeSelect name="direction" defaultValue={transaction.amount.startsWith("-") ? "OUT" : "IN"}>
                  <option value="OUT">Sortie</option>
                  <option value="IN">Entrée</option>
                </NativeSelect>
              </Field>
              <Field id="detail-amount" label="Montant TTC" error={errors.amount} required>
                <Input name="amount" inputMode="decimal" required defaultValue={transaction.amount.replace("-", "").replace(".", ",")} />
              </Field>
            </div>
          </>
        ) : null}
        <Field id="detail-category" label="Catégorie" error={errors.categoryId}>
          <CategorySelect name="categoryId" categories={options} emptyLabel="Sans catégorie" defaultValue={transaction.category?.id ?? ""} />
        </Field>
        <Field id="detail-vat" label="TVA" error={errors.vatRate} hint={transaction.vatAmount ? `Soit ${formatCurrency(transaction.vatAmount, { currency: transaction.currency })} de TVA comprise dans le montant.` : "Taux de la TVA comprise dans le montant."}>
          <VatRateSelect name="vatRate" defaultValue={transaction.vatRate ?? ""} emptyLabel="Sans TVA" />
        </Field>
        <Field id="detail-notes" label="Note" error={errors.notes} className="sm:col-span-2">
          <Textarea name="notes" rows={2} className="min-h-16" defaultValue={transaction.notes ?? ""} />
        </Field>
      </fieldset>
      {canWrite ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Enregistrer
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Rapprochement d'un encaissement avec des factures ouvertes ou des règlements déjà saisis. */
export function ReconcilePanel({ companyId, transaction, payments, suggestions, canWrite }: { companyId: string; transaction: TransactionView; payments: TransactionPaymentView[]; suggestions: ReconciliationSuggestions; canWrite: boolean }) {
  const router = useRouter();
  const currency = transaction.currency;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceAmounts, setInvoiceAmounts] = useState<Record<string, string>>({});
  const [paymentIds, setPaymentIds] = useState<Set<string>>(new Set());

  const parse = (value: string) => {
    const normalized = value.replace(/[\s  ]/g, "").replace(",", ".");
    return /^\d+(\.\d{1,2})?$/.test(normalized) ? new Decimal(normalized) : null;
  };
  const selectedTotal = [
    ...Object.values(invoiceAmounts).map((value) => parse(value) ?? new Decimal(0)),
    ...suggestions.payments.filter((p) => paymentIds.has(p.paymentId)).map((p) => new Decimal(p.amount)),
  ].reduce((acc, value) => acc.plus(value), new Decimal(0));
  const left = new Decimal(suggestions.available).minus(selectedTotal);
  const invalid = Object.values(invoiceAmounts).some((value) => parse(value) === null || parse(value)!.lessThanOrEqualTo(0));
  const count = Object.keys(invoiceAmounts).length + paymentIds.size;

  function toggleInvoice(invoiceId: string, proposed: string, remaining: string) {
    setInvoiceAmounts((current) => {
      const next = { ...current };
      if (invoiceId in next) delete next[invoiceId];
      // Montant proposé : ce qu'il reste à affecter sur l'opération, dans la limite du reste dû de la facture.
      else next[invoiceId] = Decimal.max(Decimal.min(new Decimal(remaining), left), 0).greaterThan(0) ? Decimal.min(new Decimal(remaining), left).toFixed(2).replace(".", ",") : proposed.replace(".", ",");
      return next;
    });
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setPending(true);
    setError(null);
    try {
      await action();
      toast.success(message);
      setInvoiceAmounts({});
      setPaymentIds(new Set());
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause) + (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" ? ` ${Object.values(cause.fieldErrors).join(" ")}` : ""));
    } finally {
      setPending(false);
    }
  }

  const reconcile = () =>
    run(
      () =>
        api(`/companies/${companyId}/bank/transactions/${transaction.id}/reconcile`, {
          method: "POST",
          body: { allocations: [...Object.entries(invoiceAmounts).map(([invoiceId, amount]) => ({ invoiceId, amount })), ...[...paymentIds].map((paymentId) => ({ paymentId }))] },
        }),
      "Opération rapprochée.",
    );

  return (
    <div className="grid gap-4">
      {error ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{error}</p> : null}

      {payments.length > 0 ? (
        <div className="grid gap-2">
          <ul className="divide-y rounded-xl border">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <CheckIcon className="size-4 text-success-foreground" aria-hidden="true" />
                <Link href={`/app/factures/${payment.invoiceId}`} className="font-medium hover:text-primary hover:underline">
                  Facture {payment.invoiceNumber}
                </Link>
                <span className="text-muted-foreground">{payment.customerName}</span>
                {!payment.createdFromBank ? <Badge variant="outline">Règlement saisi à la main</Badge> : null}
                <span className="tabular ml-auto font-semibold">{formatCurrency(payment.amount, { currency })}</span>
              </li>
            ))}
          </ul>
          {canWrite ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Annuler le rapprochement ? Les règlements créés par ce rapprochement seront retirés des factures concernées.")) void run(() => api(`/companies/${companyId}/bank/transactions/${transaction.id}/reconcile`, { method: "DELETE" }), "Rapprochement annulé.");
                }}
              >
                <Undo2Icon /> Annuler le rapprochement
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {new Decimal(suggestions.available).greaterThan(0) ? (
        <>
          <p className="text-sm text-muted-foreground">
            {payments.length > 0 ? "Reste à affecter" : "Montant à affecter"} : <span className="tabular font-semibold text-foreground">{formatCurrency(suggestions.available, { currency })}</span>
          </p>
          {suggestions.invoices.length === 0 && suggestions.payments.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Aucune facture en attente de règlement. Si cet encaissement n'est pas une vente (apport, remboursement…), une catégorie suffit.</p>
          ) : (
            <fieldset disabled={!canWrite || pending} className="grid gap-3">
              {suggestions.payments.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Règlements déjà enregistrés sur vos factures</p>
                  <ul className="divide-y rounded-xl border">
                    {suggestions.payments.map((payment) => (
                      <li key={payment.paymentId}>
                        <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={paymentIds.has(payment.paymentId)}
                            onChange={() =>
                              setPaymentIds((current) => {
                                const next = new Set(current);
                                if (next.has(payment.paymentId)) next.delete(payment.paymentId);
                                else next.add(payment.paymentId);
                                return next;
                              })
                            }
                          />
                          <span className="font-medium">Facture {payment.invoiceNumber}</span>
                          <span className="text-muted-foreground">{payment.customerName} · réglée le {formatDate(payment.paidAt)}</span>
                          {payment.exact ? <Badge variant="success">Montant identique</Badge> : null}
                          <span className="tabular ml-auto font-semibold">{formatCurrency(payment.amount, { currency })}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">Associer un règlement existant évite de le compter deux fois.</p>
                </div>
              ) : null}
              {suggestions.invoices.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Factures en attente de règlement</p>
                  <ul className="divide-y rounded-xl border">
                    {suggestions.invoices.map((invoice) => {
                      const checked = invoice.invoiceId in invoiceAmounts;
                      return (
                        <li key={invoice.invoiceId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                          <label className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                            <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={() => toggleInvoice(invoice.invoiceId, invoice.proposed, invoice.remaining)} aria-label={`Rapprocher la facture ${invoice.number}`} />
                            <span className="font-medium">{invoice.number}</span>
                            <span className="truncate text-muted-foreground">
                              {invoice.customerName} · reste dû {formatCurrency(invoice.remaining, { currency })}
                            </span>
                            {invoice.reasons.map((reason) => (
                              <Badge key={reason} variant="success">{reason}</Badge>
                            ))}
                          </label>
                          {checked ? (
                            <Input
                              inputMode="decimal"
                              value={invoiceAmounts[invoice.invoiceId]}
                              onChange={(e) => setInvoiceAmounts((current) => ({ ...current, [invoice.invoiceId]: e.target.value }))}
                              aria-label={`Montant affecté à la facture ${invoice.number}`}
                              className="tabular h-8 w-28 text-right"
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={reconcile} disabled={count === 0 || invalid || left.lessThan(0)}>
                    {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />}
                    Rapprocher
                  </Button>
                  {count > 0 ? (
                    <p className={left.lessThan(0) ? "text-sm font-medium text-destructive-foreground" : "text-sm text-muted-foreground"}>
                      {left.lessThan(0)
                        ? `Le total sélectionné dépasse le montant de l'opération de ${formatCurrency(left.abs().toFixed(2), { currency })}.`
                        : left.isZero()
                          ? "L'opération sera entièrement rapprochée."
                          : `Il restera ${formatCurrency(left.toFixed(2), { currency })} à affecter.`}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Doublon suspecté : l'utilisateur confirme l'opération ou la supprime. */
export function DuplicateActions({ companyId, transactionId }: { companyId: string; transactionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function keep() {
    setPending(true);
    try {
      await api(`/companies/${companyId}/bank/transactions/${transactionId}/duplicate`, { method: "DELETE" });
      toast.success("Opération confirmée : le signalement est levé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={keep} disabled={pending}>
        <CheckIcon /> Ce n'est pas un doublon
      </Button>
      <DeleteTransactionButton companyId={companyId} transactionId={transactionId} label="Supprimer ce doublon" size="sm" />
    </div>
  );
}

export function DeleteTransactionButton({ companyId, transactionId, label = "Supprimer l'opération", size = "default" }: { companyId: string; transactionId: string; label?: string; size?: "default" | "sm" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!window.confirm("Supprimer cette opération ? Ses justificatifs restent dans vos documents. La suppression est inscrite au journal d'audit.")) return;
    setPending(true);
    try {
      await api(`/companies/${companyId}/bank/transactions/${transactionId}`, { method: "DELETE" });
      toast.success("Opération supprimée.");
      setPending(false);
      router.push("/app/banque");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size={size} onClick={remove} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <Trash2Icon />} {label}
    </Button>
  );
}
