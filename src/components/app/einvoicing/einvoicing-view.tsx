"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2Icon, DownloadIcon, FileCheck2Icon, Loader2Icon, SendIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import type { EInvoiceView, IncomingView } from "@/server/modules/einvoicing/service";
import type { CategoryView } from "@/server/modules/bank/categories";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "@/components/app/bank/category-select";

const STATUS_VARIANT: Record<EInvoiceView["status"], "secondary" | "success" | "warning" | "destructive"> = {
  NOT_APPLICABLE: "secondary",
  PENDING: "secondary",
  DEPOSITED: "success",
  ACCEPTED: "success",
  PAID: "success",
  DISPUTED: "warning",
  REFUSED: "destructive",
  REJECTED: "destructive",
};

const SOURCE_LABELS: Record<string, string> = { PLATFORM: "plateforme", BUYER: "client", SELLER: "fournisseur", COMPANY: "vous" };

const dateTime = (iso: string) => `${formatDate(iso)} à ${new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;

/** Fiche facture : dépôt sur la plateforme agréée et cycle de vie. */
export function InvoiceEInvoiceCard({ companyId, invoiceId, view, canIssue }: { companyId: string; invoiceId: string; view: EInvoiceView; canIssue: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"submit" | "collected" | null>(null);
  const last = view.transmissions[0];

  async function run(kind: "submit" | "collected") {
    setPending(kind);
    try {
      const result = await api<EInvoiceView>(`/companies/${companyId}/invoices/${invoiceId}/einvoice${kind === "collected" ? "/collected" : ""}`, { method: "POST" });
      if (kind === "submit") {
        if (result.status === "DEPOSITED") toast.success("Facture déposée sur la plateforme.");
        else toast.info("Dépôt en attente : la plateforme n'a pas répondu, une nouvelle tentative est programmée.");
      } else toast.success("Encaissement déclaré.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setPending(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          Facture électronique
          <Badge variant={STATUS_VARIANT[view.status]}>{view.statusLabel}</Badge>
        </CardTitle>
        <CardDescription>Dépôt sur la plateforme agréée et suivi du cycle de vie (déposée, refusée, encaissée…).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {view.problems.length > 0 && !last ? (
          <ul className="list-disc pl-5 text-muted-foreground">{view.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : null}
        {last?.status === "QUEUED" && last.lastError ? <p className="text-warning-foreground">Dernière tentative en échec ({last.attempts}) : {last.lastError}. Nouvelle tentative programmée.</p> : null}
        {last?.status === "FAILED" ? <p className="text-destructive-foreground">Dépôt abandonné après {last.attempts} tentatives : {last.lastError}</p> : null}
        {view.events.length > 0 ? (
          <ol className="grid gap-2">
            {view.events.map((e) => (
              <li key={`${e.code}-${e.occurredAt}`} className="flex gap-2">
                <FileCheck2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{e.label}</span> · {dateTime(e.occurredAt)} ({SOURCE_LABELS[e.source] ?? e.source})
                  {e.reason ? <span className="block text-muted-foreground">Motif : {e.reason}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {canIssue && (view.canSubmit || view.canDeclareCollected) ? (
          <div className="flex flex-wrap gap-2">
            {view.canSubmit ? (
              <Button size="sm" disabled={pending !== null} onClick={() => run("submit")}>
                {pending === "submit" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {view.transmissions.length ? "Déposer à nouveau" : "Déposer sur la plateforme"}
              </Button>
            ) : null}
            {view.canDeclareCollected ? (
              <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run("collected")}>
                {pending === "collected" ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} Déclarer l&apos;encaissement
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Activation de la réception des factures électroniques. */
export function ReceptionToggle({ companyId, active, canManage }: { companyId: string; active: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Card className="mb-6">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="max-w-2xl text-sm">
          <p className="font-medium">{active ? "Réception activée" : "Réception non activée"}</p>
          <p className="text-muted-foreground">
            {active
              ? "Les factures électroniques adressées au SIREN de l'entreprise arrivent ici, avec leur original. Vous les enregistrez en achat ou les refusez avec un motif transmis au fournisseur."
              : "Activez la réception pour recevoir ici les factures électroniques de vos fournisseurs adressées au SIREN de l'entreprise."}
          </p>
        </div>
        {canManage ? (
          <Button
            variant={active ? "outline" : "default"}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await api(`/companies/${companyId}/einvoices/reception`, { method: "PUT", body: { active: !active } });
                toast.success(active ? "Réception désactivée." : "Réception activée.");
                router.refresh();
              } catch (error) {
                toast.error(errorMessage(error));
              }
              setPending(false);
            }}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : null} {active ? "Désactiver" : "Activer la réception"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

const INCOMING_STATUS: Record<IncomingView["status"], { label: string; variant: "secondary" | "success" | "destructive" }> = {
  RECEIVED: { label: "À traiter", variant: "secondary" },
  PURCHASE_CREATED: { label: "Enregistrée en achat", variant: "success" },
  REFUSED: { label: "Refusée", variant: "destructive" },
};

function IncomingRow({ companyId, item, categories, canWrite }: { companyId: string; item: IncomingView; categories: CategoryView[]; canWrite: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"purchase" | "refuse" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = INCOMING_STATUS[item.status];
  const money = (v: string) => formatCurrency(v, { currency: item.currency });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (dialog === "purchase") {
        const { purchaseId } = await api<{ purchaseId: string }>(`/companies/${companyId}/einvoices/incoming/${item.id}/purchase`, { method: "POST", body: form });
        toast.success("Facture enregistrée en achat.");
        router.push(`/app/achats/${purchaseId}`);
      } else {
        await api(`/companies/${companyId}/einvoices/incoming/${item.id}/status`, { method: "POST", body: { code: 210, reason: form.reason } });
        toast.success("Refus transmis au fournisseur.");
        setDialog(null);
        router.refresh();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
    setPending(false);
  }

  return (
    <li className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {item.sellerName} · {item.creditNote ? "Avoir" : "Facture"} {item.number}
        </p>
        <p className="text-sm text-muted-foreground">
          Du {formatDate(item.issueDate)}
          {item.dueDate ? ` · échéance le ${formatDate(item.dueDate)}` : ""} · reçue le {formatDate(item.receivedAt)}
          {item.lastStatus ? ` · dernier statut transmis : ${item.lastStatus}` : ""}
        </p>
      </div>
      <p className="tabular font-semibold">{money(item.totalInclTax)}</p>
      <Badge variant={status.variant}>{status.label}</Badge>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="ghost">
          <a href={`/api/v1/companies/${companyId}/einvoices/incoming/${item.id}/xml`} download>
            <DownloadIcon /> XML
          </a>
        </Button>
        {item.documentId ? (
          <Button asChild size="sm" variant="ghost">
            <a href={`/app/documents/${item.documentId}`}>PDF</a>
          </Button>
        ) : null}
        {canWrite && item.status === "RECEIVED" ? (
          <>
            {!item.creditNote ? (
              <Button size="sm" onClick={() => setDialog("purchase")}>
                <CheckCircle2Icon /> Enregistrer en achat
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setDialog("refuse")}>
              <XCircleIcon /> Refuser
            </Button>
          </>
        ) : null}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "purchase" ? "Enregistrer en achat" : "Refuser la facture"}</DialogTitle>
            <DialogDescription>
              {dialog === "purchase"
                ? `${money(item.totalExclTax)} HT, ${money(item.totalVat)} de TVA. Le fournisseur est retrouvé par son SIREN, ou créé.`
                : "Le refus (statut 210) et son motif sont transmis au fournisseur par la plateforme. Il ne peut pas être annulé."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {error ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{error}</p> : null}
            {dialog === "purchase" ? (
              <Field id={`incoming-category-${item.id}`} label="Catégorie de dépense" required>
                <CategorySelect name="categoryId" categories={categories} emptyLabel="Choisir…" required defaultValue="" />
              </Field>
            ) : (
              <Field id={`incoming-reason-${item.id}`} label="Motif du refus" required>
                <Input name="reason" required maxLength={500} placeholder="Ex. : prestation non réalisée, montant erroné…" />
              </Field>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" variant={dialog === "refuse" ? "destructive" : "default"} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : null} {dialog === "purchase" ? "Enregistrer" : "Refuser"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function IncomingList({ companyId, items, categories, canWrite }: { companyId: string; items: IncomingView[]; categories: CategoryView[]; canWrite: boolean }) {
  return (
    <Card>
      <CardContent className="py-5">
        <ul className="divide-y">
          {items.map((item) => (
            <IncomingRow key={item.id} companyId={companyId} item={item} categories={categories} canWrite={canWrite} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
