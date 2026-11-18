"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CreditCardIcon, ExternalLinkIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import type { BillingOverview } from "@/server/billing/service";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "accent" | "outline" }> = {
  TRIALING: { label: "Essai", variant: "accent" },
  ACTIVE: { label: "Actif", variant: "success" },
  PAST_DUE: { label: "Paiement en échec", variant: "warning" },
  UNPAID: { label: "Impayé", variant: "destructive" },
  INCOMPLETE: { label: "Paiement à finaliser", variant: "warning" },
  CANCELED: { label: "Résilié", variant: "outline" },
  EXPIRED: { label: "Expiré", variant: "outline" },
};

const PAYMENT_STATUS: Record<string, string> = { paid: "Payée", open: "À régler", failed: "Échec", void: "Annulée", uncollectible: "Irrécouvrable", draft: "Brouillon" };

export function BillingView({ overview, returnState, sessionId }: { overview: BillingOverview; returnState: "succes" | "annule" | null; sessionId: string | null }) {
  const router = useRouter();
  const subscription = overview.subscription;
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">(subscription?.interval ?? "MONTHLY");
  const [busy, setBusy] = useState<string | null>(null);
  const handled = useRef(false);

  // Retour de la page de paiement : synchronisation immédiate, sans attendre le webhook.
  useEffect(() => {
    if (handled.current || !returnState) return;
    handled.current = true;
    if (returnState === "annule") {
      toast.info("Paiement annulé : aucun montant n'a été prélevé.");
      router.replace("/app/abonnement");
      return;
    }
    const sync = sessionId ? api("/me/billing/complete", { method: "POST", body: { sessionId } }) : Promise.resolve();
    sync
      .then(() => toast.success("Merci ! Votre abonnement est enregistré."))
      .catch(() => toast.info("Paiement reçu : votre abonnement sera actif dans quelques instants."))
      .finally(() => router.replace("/app/abonnement"));
  }, [returnState, sessionId, router]);

  async function go(name: string, action: () => Promise<{ url?: string } | unknown>, message?: string) {
    setBusy(name);
    try {
      const result = (await action()) as { url?: string } | undefined;
      if (result && typeof result === "object" && result.url) {
        window.location.assign(result.url);
        return;
      }
      if (message) toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const managed = subscription?.managedByStripe ?? false;
  const status = subscription ? STATUS[subscription.status] : null;
  const canPayOnline = overview.stripeEnabled;

  return (
    <div className="grid gap-6">
      {subscription ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Formule {subscription.planName} {status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
              </CardTitle>
              <CardDescription className="mt-1">
                {subscription.status === "TRIALING" && subscription.trialEndsAt ? `Essai jusqu'au ${formatDate(subscription.trialEndsAt.slice(0, 10), "long")}. ` : ""}
                {subscription.priceAmount ? `${formatCurrency(subscription.priceAmount)} par ${subscription.interval === "YEARLY" ? "an" : "mois"}. ` : ""}
                {subscription.currentPeriodEnd && managed ? (subscription.cancelAtPeriodEnd ? `Prend fin le ${formatDate(subscription.currentPeriodEnd.slice(0, 10), "long")}.` : `Prochain renouvellement le ${formatDate(subscription.currentPeriodEnd.slice(0, 10), "long")}.`) : ""}
              </CardDescription>
            </div>
            {managed ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy !== null} onClick={() => go("portal", () => api("/me/billing/portal", { method: "POST" }))}>
                  {busy === "portal" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CreditCardIcon />} Moyen de paiement et coordonnées
                </Button>
                {subscription.cancelAtPeriodEnd ? (
                  <Button disabled={busy !== null} onClick={() => go("resume", () => api("/me/billing/cancel", { method: "POST", body: { cancel: false } }), "Votre abonnement continue.")}>
                    {busy === "resume" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Reprendre l'abonnement
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm("Résilier votre abonnement ? Il restera actif jusqu'à la fin de la période déjà payée ; vos données resteront ensuite consultables et exportables.")) void go("cancel", () => api("/me/billing/cancel", { method: "POST", body: { cancel: true } }), "Résiliation enregistrée pour la fin de la période.");
                    }}
                  >
                    Résilier
                  </Button>
                )}
              </div>
            ) : null}
          </CardHeader>
          {subscription.paymentFailedAt ? (
            <CardContent>
              <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">Le dernier paiement a échoué. Stripe tentera de nouveau le prélèvement ; mettez à jour votre moyen de paiement pour éviter une interruption.</p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {!canPayOnline ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">Le paiement en ligne n'est pas encore ouvert. Pour souscrire dès maintenant, contactez le support depuis la page Support.</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{managed ? "Changer de formule" : "Choisir une formule"}</h2>
        <div role="radiogroup" aria-label="Périodicité" className="flex gap-1 rounded-xl border bg-card p-1 shadow-xs">
          {(["MONTHLY", "YEARLY"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={interval === value} onClick={() => setInterval(value)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", interval === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {value === "MONTHLY" ? "Mensuel" : "Annuel"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {overview.plans.map((plan) => {
          const current = subscription?.planKey === plan.key && (subscription.interval === interval || !managed);
          const available = interval === "YEARLY" ? plan.yearlyAvailable : plan.monthlyAvailable;
          const price = interval === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
          const blocked = plan.fitProblems.length > 0;
          const trialSwitch = !managed && overview.standing === "trial";
          return (
            <Card key={plan.key} className={cn(current && "border-primary ring-1 ring-primary")}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">{plan.name} {current ? <Badge variant="accent">Formule actuelle</Badge> : null}</CardTitle>
                <CardDescription>{plan.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p>
                  <span className="tabular font-display text-3xl font-bold">{formatCurrency(price, { currency: plan.currency })}</span>
                  <span className="text-sm text-muted-foreground"> HT / {interval === "YEARLY" ? "an" : "mois"}</span>
                </p>
                <ul className="grid gap-1.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2"><CheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />{f}</li>
                  ))}
                </ul>
                {blocked && !current ? <p className="text-xs text-warning-foreground">{plan.fitProblems.join(" ")}</p> : null}
                {current && managed ? null : managed ? (
                  <Button variant="outline" disabled={busy !== null || blocked || !available} onClick={() => { if (window.confirm(`Passer à la formule ${plan.name} (${interval === "YEARLY" ? "annuelle" : "mensuelle"}) ? La différence est calculée au prorata sur votre prochaine facture.`)) void go(`plan-${plan.key}`, () => api("/me/billing/plan", { method: "POST", body: { plan: plan.key, interval } }), `Formule ${plan.name} activée.`); }}>
                    {busy === `plan-${plan.key}` ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Passer à {plan.name}
                  </Button>
                ) : (
                  <div className="grid gap-2">
                    <Button disabled={busy !== null || blocked || !available} onClick={() => go(`checkout-${plan.key}`, () => api("/me/billing/checkout", { method: "POST", body: { plan: plan.key, interval } }))}>
                      {busy === `checkout-${plan.key}` ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Souscrire {plan.name}
                    </Button>
                    {trialSwitch && !current && !blocked ? (
                      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => go(`trial-${plan.key}`, () => api("/me/billing/plan", { method: "POST", body: { plan: plan.key, interval } }), `Essai poursuivi avec la formule ${plan.name}.`)}>
                        Essayer {plan.name} pendant l'essai
                      </Button>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Le paiement est réalisé sur la page sécurisée de Stripe : aucune donnée de carte bancaire ne transite par ComptaPro Digital. Le passage à une formule plus réduite conserve vos données ; les modules qu'elle n'inclut plus restent consultables.</p>

      <Card>
        <CardHeader>
          <CardTitle>Paiements et factures d'abonnement</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-4">
          {overview.payments.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">Aucun paiement pour l'instant.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent"><TableHead>Date</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="text-right">Facture</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {overview.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular">{formatDate(p.date.slice(0, 10))}</TableCell>
                    <TableCell><Badge variant={p.status === "paid" ? "success" : p.status === "failed" ? "destructive" : "outline"}>{PAYMENT_STATUS[p.status] ?? p.status}</Badge></TableCell>
                    <TableCell className="tabular text-right font-medium">{formatCurrency(p.amount, { currency: p.currency })}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {p.invoicePdfUrl ? <a href={p.invoicePdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><FileTextIcon className="size-4" /> PDF</a> : null}
                      {p.hostedInvoiceUrl ? <a href={p.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="ml-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{p.status === "paid" ? "Voir" : "Régler"} <ExternalLinkIcon className="size-3.5" /></a> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
