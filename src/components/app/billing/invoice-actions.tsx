"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellRingIcon, CircleDollarSignIcon, FileDownIcon, FileMinus2Icon, Loader2Icon, PencilIcon, SendIcon, StampIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { InvoiceView } from "@/server/modules/invoicing/invoices";
import type { VatRateView } from "@/server/modules/products/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/invoicing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { SendDialog, type SendDefaults } from "@/components/app/billing/send-dialog";

type Permissions = { canWrite: boolean; canIssue: boolean; canPay: boolean };
type DialogName = "issue" | "send" | "payment" | "credit" | "delete" | null;

export function InvoiceActions({
  companyId,
  invoice,
  permissions,
  sendDefaults,
  vatRates,
  today,
}: {
  companyId: string;
  invoice: InvoiceView;
  permissions: Permissions;
  sendDefaults: SendDefaults;
  vatRates: VatRateView[];
  today: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [creditMode, setCreditMode] = useState<"full" | "partial">("full");

  const base = `/companies/${companyId}/invoices/${invoice.id}`;
  const draft = invoice.status === "DRAFT";
  const creditNote = invoice.type === "CREDIT_NOTE";
  const open = !draft && !creditNote && Number(invoice.remaining) > 0;
  const creditable = !draft && !creditNote && Number(invoice.creditedAmount) < Number(invoice.totalInclTax);
  const money = (value: string) => formatCurrency(value, { currency: "EUR" });

  function openDialog(name: DialogName) {
    setErrors({});
    setFormError(null);
    setDialog(name);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const issue = () =>
    run(async () => {
      const issued = await api<InvoiceView>(`${base}/issue`, { method: "POST" });
      toast.success(`${creditNote ? "Avoir émis" : "Facture émise"} sous le numéro ${issued.number}.`);
      setDialog(null);
      router.refresh();
    });

  const remove = () =>
    run(async () => {
      await api(base, { method: "DELETE" });
      toast.success("Brouillon supprimé.");
      router.push("/app/factures");
      router.refresh();
    });

  const remind = () =>
    run(async () => {
      const result = await api<{ to: string; rank: number }>(`${base}/remind`, { method: "POST" });
      toast.success(`Relance n° ${result.rank} envoyée à ${result.to}.`);
      router.refresh();
    }).then(() => undefined);

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await api(`${base}/payments`, { method: "POST", body: Object.fromEntries(form.entries()) });
      toast.success("Règlement enregistré.");
      setDialog(null);
      router.refresh();
    });
  }

  function submitCredit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "");
    const items =
      creditMode === "partial"
        ? [{ description: String(form.get("description") || reason), quantity: "1", unitPriceExclTax: String(form.get("amount") ?? ""), discountRate: "0", vatRate: String(form.get("vatRate") ?? "0") }]
        : undefined;
    void run(async () => {
      const created = await api<InvoiceView>(`${base}/credit-note`, { method: "POST", body: { reason, items } });
      toast.success("Avoir préparé : vérifiez-le puis émettez-le.");
      setDialog(null);
      router.push(`/app/factures/${created.id}`);
      router.refresh();
    });
  }

  const errorBox = formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <a href={`/api/v1${base}/pdf`} target="_blank" rel="noopener">
            <FileDownIcon /> {draft ? "Aperçu PDF" : "PDF"}
          </a>
        </Button>
        {draft && permissions.canWrite && !creditNote ? (
          <Button asChild variant="outline">
            <Link href={`/app/factures/${invoice.id}/modifier`}><PencilIcon /> Modifier</Link>
          </Button>
        ) : null}
        {draft && permissions.canWrite ? (
          <Button variant="outline" onClick={() => openDialog("delete")}><Trash2Icon className="text-destructive-foreground" /> Supprimer</Button>
        ) : null}
        {draft && permissions.canIssue ? (
          <Button onClick={() => openDialog("issue")}><StampIcon /> {creditNote ? "Émettre l'avoir" : "Émettre la facture"}</Button>
        ) : null}
        {!draft && permissions.canWrite ? (
          <Button variant={invoice.sentAt ? "outline" : "default"} onClick={() => openDialog("send")}><SendIcon /> {invoice.sentAt ? "Renvoyer" : "Envoyer"}</Button>
        ) : null}
        {open && invoice.overdue && permissions.canWrite ? (
          <Button variant="outline" onClick={remind} disabled={pending}><BellRingIcon /> Relancer</Button>
        ) : null}
        {open && permissions.canPay ? (
          <Button variant="success" onClick={() => openDialog("payment")}><CircleDollarSignIcon /> Enregistrer un règlement</Button>
        ) : null}
        {creditable && permissions.canIssue ? (
          <Button variant="outline" onClick={() => { setCreditMode("full"); openDialog("credit"); }}><FileMinus2Icon /> Créer un avoir</Button>
        ) : null}
      </div>
      {dialog === null && formError ? <p role="alert" className="mt-3 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}

      {/* Émission */}
      <Dialog open={dialog === "issue"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creditNote ? "Émettre cet avoir ?" : "Émettre cette facture ?"}</DialogTitle>
            <DialogDescription>
              Un numéro définitif lui sera attribué dans la suite chronologique. Une fois émis{creditNote ? "" : "e"}, {creditNote ? "l'avoir" : "la facture"} ne peut
              plus être modifié{creditNote ? "" : "e"} ni supprimé{creditNote ? "" : "e"}{creditNote ? "." : " : toute correction passera par un avoir."}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 rounded-xl border bg-muted/40 p-4 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{invoice.customerName}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Date d'émission</dt><dd className="font-medium">{invoice.issueDate ? formatDate(invoice.issueDate) : "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Total TTC</dt><dd className="tabular font-semibold">{money(invoice.totalInclTax)}</dd></div>
          </dl>
          {errorBox}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button onClick={issue} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <StampIcon aria-hidden="true" />}
              Émettre définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suppression du brouillon */}
      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce brouillon ?</DialogTitle>
            <DialogDescription>Le brouillon n'a pas de numéro : sa suppression ne laisse aucun trou dans la numérotation.</DialogDescription>
          </DialogHeader>
          {errorBox}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button variant="destructive" onClick={remove} disabled={pending}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Règlement */}
      <Dialog open={dialog === "payment"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un règlement</DialogTitle>
            <DialogDescription>Reste à encaisser : {money(invoice.remaining)}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPayment} noValidate className="grid gap-5">
            {errorBox}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="payment-amount" label="Montant" error={errors.amount} required>
                <Input name="amount" inputMode="decimal" defaultValue={invoice.remaining.replace(".", ",")} required />
              </Field>
              <Field id="payment-date" label="Date du règlement" error={errors.paidAt} required>
                <Input name="paidAt" type="date" defaultValue={today} max={today} required />
              </Field>
              <Field id="payment-method" label="Moyen de paiement" error={errors.method}>
                <NativeSelect name="method" defaultValue="TRANSFER">
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="payment-reference" label="Référence" error={errors.reference} hint="Ex. numéro de chèque, libellé du virement">
                <Input name="reference" />
              </Field>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
              <Button type="submit" variant="success" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Enregistrer le règlement
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Avoir */}
      <Dialog open={dialog === "credit"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un avoir</DialogTitle>
            <DialogDescription>
              L'avoir est la seule façon de corriger ou d'annuler une facture émise. Il est préparé en brouillon ; vous le vérifiez avant de l'émettre.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCredit} noValidate className="grid gap-5">
            {errorBox}
            <Field id="credit-reason" label="Motif" error={errors.reason} required>
              <Input name="reason" placeholder="Ex. Erreur de quantité, geste commercial, annulation" required />
            </Field>
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 font-medium">Étendue de l'avoir</legend>
              <label className="flex items-center gap-3">
                <input type="radio" name="mode" className="size-4 accent-[var(--primary)]" checked={creditMode === "full"} onChange={() => setCreditMode("full")} />
                Avoir total — reprend toutes les lignes de la facture ({money(invoice.totalInclTax)} TTC)
              </label>
              <label className="flex items-center gap-3">
                <input type="radio" name="mode" className="size-4 accent-[var(--primary)]" checked={creditMode === "partial"} onChange={() => setCreditMode("partial")} />
                Avoir partiel — un montant à déduire
              </label>
            </fieldset>
            {creditMode === "partial" ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="credit-description" label="Désignation" error={errors["items.0.description"]} className="sm:col-span-2" hint="Vide : le motif est repris.">
                  <Input name="description" />
                </Field>
                <Field id="credit-amount" label="Montant HT" error={errors["items.0.unitPriceExclTax"]} required>
                  <Input name="amount" inputMode="decimal" required />
                </Field>
                <Field id="credit-vat" label="Taux de TVA" error={errors["items.0.vatRate"]} required>
                  <NativeSelect name="vatRate" defaultValue={invoice.vatBreakdown[0]?.rate ?? "0"}>
                    {[...new Set([...invoice.vatBreakdown.map((r) => Number(r.rate)), ...vatRates.map((r) => Number(r.rate))])].map((rate) => (
                      <option key={rate} value={rate}>{rate.toLocaleString("fr-FR")} %</option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            ) : null}
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Préparer l'avoir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SendDialog endpoint={`${base}/send`} defaults={sendDefaults} open={dialog === "send"} onOpenChange={(o) => !o && setDialog(null)} documentLabel={creditNote ? "Avoir" : "Facture"} />
    </>
  );
}

/** Suppression d'un règlement saisi par erreur. */
export function DeletePaymentButton({ companyId, invoiceId, paymentId }: { companyId: string; invoiceId: string; paymentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label="Supprimer ce règlement"
      onClick={async () => {
        setPending(true);
        try {
          await api(`/companies/${companyId}/invoices/${invoiceId}/payments/${paymentId}`, { method: "DELETE" });
          toast.success("Règlement supprimé.");
          router.refresh();
        } catch (error) {
          toast.error(errorMessage(error));
        } finally {
          setPending(false);
        }
      }}
    >
      <Trash2Icon className="text-destructive-foreground" />
    </Button>
  );
}
