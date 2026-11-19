"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import type { AdminPlan } from "@/server/modules/admin/plans";
import { PLAN_MODULES } from "@/lib/schemas/admin";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

export function PlanEditor({ plan, stripeEnabled }: { plan: AdminPlan; stripeEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"save" | "sync" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modules, setModules] = useState<string[]>(plan.limits.modules);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending("save");
    setErrors({});
    try {
      const result = await api<{ stripeSync: { error?: string } | null }>(`/admin/plans/${plan.id}`, {
        method: "PUT",
        body: {
          name: form.get("name"),
          tagline: form.get("tagline"),
          monthlyPrice: form.get("monthlyPrice"),
          yearlyPrice: form.get("yearlyPrice"),
          trialDays: form.get("trialDays"),
          sortOrder: form.get("sortOrder"),
          features: String(form.get("features") ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
          limits: { maxCompanies: form.get("maxCompanies"), maxMembers: form.get("maxMembers"), aiRequestsPerMonth: form.get("aiRequestsPerMonth"), modules },
          isActive: form.get("isActive") === "on",
          isFeatured: form.get("isFeatured") === "on",
        },
      });
      if (result.stripeSync?.error) toast.warning(`Formule enregistrée, mais la synchronisation Stripe a échoué : ${result.stripeSync.error}`);
      else toast.success(`Formule ${plan.key} enregistrée.`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function sync() {
    setPending("sync");
    try {
      await api(`/admin/plans/${plan.id}/stripe`, { method: "POST" });
      toast.success("Produit et prix Stripe à jour.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  const id = (name: string) => `plan-${plan.key}-${name}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plan.name} <Badge variant="outline">{plan.key}</Badge>
          {plan.isActive ? <Badge variant="success">Proposée</Badge> : <Badge variant="secondary">Retirée</Badge>}
        </CardTitle>
        <CardDescription>
          {plan.subscribers} abonnement(s) ·{" "}
          {plan.stripeMonthlyPriceId && plan.stripeYearlyPriceId ? `Stripe : ${plan.stripeMonthlyPriceId} / ${plan.stripeYearlyPriceId}` : "Pas encore synchronisée avec Stripe"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id={id("name")} label="Nom" error={errors.name} required><Input name="name" defaultValue={plan.name} maxLength={60} required /></Field>
            <Field id={id("tagline")} label="Accroche" error={errors.tagline}><Input name="tagline" defaultValue={plan.tagline ?? ""} maxLength={160} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id={id("monthly")} label="Prix mensuel HT (€)" error={errors.monthlyPrice} required><Input name="monthlyPrice" inputMode="decimal" defaultValue={plan.monthlyPrice} required /></Field>
            <Field id={id("yearly")} label="Prix annuel HT (€)" error={errors.yearlyPrice} required><Input name="yearlyPrice" inputMode="decimal" defaultValue={plan.yearlyPrice} required /></Field>
            <Field id={id("trial")} label="Essai (jours)" error={errors.trialDays} hint="0 = sans essai"><Input name="trialDays" type="number" min={0} max={90} defaultValue={plan.trialDays} /></Field>
            <Field id={id("order")} label="Ordre d'affichage" error={errors.sortOrder}><Input name="sortOrder" type="number" min={0} max={100} defaultValue={plan.sortOrder} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={id("maxCompanies")} label="Entreprises maximum" error={errors["limits.maxCompanies"]} hint="Vide = illimité"><Input name="maxCompanies" type="number" min={1} defaultValue={plan.limits.maxCompanies ?? ""} /></Field>
            <Field id={id("maxMembers")} label="Membres par entreprise maximum" error={errors["limits.maxMembers"]} hint="Vide = illimité ; propriétaire inclus"><Input name="maxMembers" type="number" min={1} defaultValue={plan.limits.maxMembers ?? ""} /></Field>
            <Field id={id("aiRequests")} label="Requêtes IA par mois et par entreprise" error={errors["limits.aiRequestsPerMonth"]} hint="Vide = illimité ; module « Assistant IA » requis"><Input name="aiRequestsPerMonth" type="number" min={0} defaultValue={plan.limits.aiRequestsPerMonth ?? ""} /></Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Modules inclus</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PLAN_MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={modules.includes(m.key)} onChange={(e) => setModules((prev) => (e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key)))} />
                  {m.label}
                </label>
              ))}
            </div>
            {errors["limits.modules"] ? <p className="mt-1 text-sm text-destructive">{errors["limits.modules"]}</p> : null}
          </fieldset>
          <Field id={id("features")} label="Arguments affichés (un par ligne)" error={errors.features}>
            <Textarea name="features" rows={5} defaultValue={plan.features.join("\n")} />
          </Field>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={plan.isActive} className="size-4" /> Proposée à la souscription</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="isFeatured" defaultChecked={plan.isFeatured} className="size-4" /> Mise en avant</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending !== null}>{pending === "save" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SaveIcon />} Enregistrer</Button>
            {stripeEnabled ? (
              <Button type="button" variant="outline" onClick={sync} disabled={pending !== null}>{pending === "sync" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <RefreshCwIcon />} Synchroniser avec Stripe</Button>
            ) : (
              <p className="self-center text-xs text-muted-foreground">Stripe n'est pas configuré : la synchronisation des prix sera disponible une fois STRIPE_SECRET_KEY renseignée.</p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
