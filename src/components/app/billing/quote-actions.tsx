"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, FileDownIcon, Loader2Icon, PencilIcon, ReceiptTextIcon, SendIcon, Trash2Icon, UndoIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { QuoteView } from "@/server/modules/invoicing/quotes";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SendDialog, type SendDefaults } from "@/components/app/billing/send-dialog";

type DialogName = "send" | "convert" | "delete" | null;

export function QuoteActions({
  companyId,
  quote,
  canWrite,
  canInvoice,
  depositsAvailable,
  sendDefaults,
}: {
  companyId: string;
  quote: QuoteView;
  canWrite: boolean;
  canInvoice: boolean;
  depositsAvailable: boolean;
  sendDefaults: SendDefaults;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"invoice" | "deposit">("invoice");
  useResetOnHide(() => setDialog(null));

  const base = `/companies/${companyId}/quotes/${quote.id}`;
  const status = quote.status;
  const invoiceable = (status === "SENT" || status === "ACCEPTED") && canInvoice;
  const hasFinalInvoice = quote.invoices.some((i) => i.type === "INVOICE" && i.status !== "CANCELLED");

  async function run(action: () => Promise<void>) {
    setPending(true);
    setFormError(null);
    setErrors({});
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else if (dialog) setFormError(errorMessage(error));
      else toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const setStatus = (next: "SENT" | "ACCEPTED" | "REJECTED" | "DRAFT", message: string) =>
    run(async () => {
      await api(`${base}/status`, { method: "POST", body: { status: next } });
      toast.success(message);
      router.refresh();
    });

  function convert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percent = new FormData(event.currentTarget).get("percent");
    void run(async () => {
      const invoice = await api<{ id: string }>(`${base}/convert`, { method: "POST", body: mode === "deposit" ? { mode, percent } : { mode } });
      toast.success(mode === "deposit" ? "Facture d'acompte préparée en brouillon." : "Facture préparée en brouillon.");
      setDialog(null);
      router.push(`/app/factures/${invoice.id}`);
      router.refresh();
    });
  }

  const remove = () =>
    run(async () => {
      await api(base, { method: "DELETE" });
      toast.success("Devis supprimé.");
      router.push("/app/devis");
      router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <a href={`/api/v1${base}/pdf`} target="_blank" rel="noopener"><FileDownIcon /> PDF</a>
        </Button>
        {canWrite && status === "DRAFT" ? (
          <>
            <Button asChild variant="outline">
              <Link href={`/app/devis/${quote.id}/modifier`}><PencilIcon /> Modifier</Link>
            </Button>
            <Button variant="outline" onClick={() => setDialog("delete")}><Trash2Icon className="text-destructive-foreground" /> Supprimer</Button>
          </>
        ) : null}
        {canWrite && (status === "SENT" || status === "REJECTED") ? (
          <Button variant="outline" disabled={pending} onClick={() => setStatus("DRAFT", "Devis repassé en brouillon.")}><UndoIcon /> Repasser en brouillon</Button>
        ) : null}
        {canWrite && status !== "INVOICED" && status !== "EXPIRED" ? (
          <Button variant={status === "DRAFT" ? "default" : "outline"} onClick={() => { setFormError(null); setDialog("send"); }}>
            <SendIcon /> {status === "DRAFT" ? "Envoyer" : "Renvoyer"}
          </Button>
        ) : null}
        {canWrite && status === "DRAFT" ? (
          <Button variant="outline" disabled={pending} onClick={() => setStatus("SENT", "Devis marqué comme envoyé.")}>Marquer comme envoyé</Button>
        ) : null}
        {canWrite && status === "SENT" ? (
          <>
            <Button variant="outline" disabled={pending} onClick={() => setStatus("REJECTED", "Devis marqué comme refusé.")}><XIcon /> Refusé</Button>
            <Button variant="success" disabled={pending} onClick={() => setStatus("ACCEPTED", "Devis accepté.")}><CheckIcon /> Accepté</Button>
          </>
        ) : null}
        {invoiceable && !hasFinalInvoice ? (
          <Button onClick={() => { setFormError(null); setMode("invoice"); setDialog("convert"); }}><ReceiptTextIcon /> Facturer</Button>
        ) : null}
      </div>

      <Dialog open={dialog === "convert"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Facturer ce devis</DialogTitle>
            <DialogDescription>La facture est préparée en brouillon à partir du devis ; vous la vérifiez avant de l'émettre.</DialogDescription>
          </DialogHeader>
          <form onSubmit={convert} noValidate className="grid gap-5">
            {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
            <fieldset className="grid gap-3 text-sm">
              <legend className="sr-only">Type de facture</legend>
              <label className="flex items-start gap-3">
                <input type="radio" name="mode" className="mt-0.5 size-4 accent-[var(--primary)]" checked={mode === "invoice"} onChange={() => setMode("invoice")} />
                <span>
                  <span className="font-medium">Facture du devis</span>
                  <span className="block text-muted-foreground">
                    Reprend toutes les lignes ({formatCurrency(quote.totalInclTax)} TTC). Les acomptes déjà facturés sont déduits.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input type="radio" name="mode" className="mt-0.5 size-4 accent-[var(--primary)]" checked={mode === "deposit"} disabled={!depositsAvailable} onChange={() => setMode("deposit")} />
                <span>
                  <span className="font-medium">Facture d'acompte</span>
                  <span className="block text-muted-foreground">
                    {depositsAvailable ? "Un pourcentage du devis, à régler avant la prestation." : "Inclus à partir de la formule Pro."}
                  </span>
                </span>
              </label>
            </fieldset>
            {mode === "deposit" ? (
              <Field id="convert-percent" label="Pourcentage d'acompte" error={errors.percent} required>
                <Input name="percent" inputMode="decimal" defaultValue="30" className="w-32" required />
              </Field>
            ) : null}
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Préparer la facture
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce devis ?</DialogTitle>
            <DialogDescription>Le devis {quote.number} en brouillon sera définitivement supprimé.</DialogDescription>
          </DialogHeader>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button variant="destructive" onClick={remove} disabled={pending}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendDialog endpoint={`${base}/send`} defaults={sendDefaults} open={dialog === "send"} onOpenChange={(o) => !o && setDialog(null)} documentLabel="Devis" />
    </>
  );
}
