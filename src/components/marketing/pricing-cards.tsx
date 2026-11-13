"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { PublicPlan } from "@/server/modules/plans/service";
import { comparisonRows } from "@/config/marketing";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Interval = "monthly" | "yearly";

function displayPrice(amount: string, currency: string) {
  return formatCurrency(amount, { currency }).replace(/,00(?=\s)/, "");
}

export function PricingCards({ plans, showComparison }: { plans: PublicPlan[]; showComparison: boolean }) {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <div>
      <div className="flex justify-center">
        <div role="group" aria-label="Périodicité de facturation" className="inline-flex rounded-xl border bg-card p-1 shadow-xs">
          {(["monthly", "yearly"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              aria-pressed={interval === value}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                interval === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "monthly" ? "Mensuel" : "Annuel"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid items-stretch gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const yearly = Number(plan.yearlyPrice);
          const monthly = Number(plan.monthlyPrice);
          const saving = monthly > 0 ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
          return (
            <article
              key={plan.key}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-7 shadow-card",
                plan.isFeatured && "border-primary shadow-elevated ring-1 ring-primary",
              )}
            >
              {plan.isFeatured ? <Badge className="absolute -top-3 left-7">Le plus choisi</Badge> : null}
              <h3 className="text-xl font-bold">{plan.name}</h3>
              {plan.tagline ? <p className="mt-1.5 text-sm text-muted-foreground">{plan.tagline}</p> : null}

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="tabular font-display text-4xl font-bold">
                  {displayPrice(interval === "monthly" ? plan.monthlyPrice : plan.yearlyPrice, plan.currency)}
                </span>
                <span className="text-sm text-muted-foreground">HT / {interval === "monthly" ? "mois" : "an"}</span>
              </p>
              <p className="mt-1 min-h-5 text-sm text-success-foreground">
                {interval === "yearly" && saving > 0 ? `Soit ${saving} % d'économie par rapport au mensuel` : ""}
              </p>

              <Button asChild size="lg" variant={plan.isFeatured ? "default" : "outline"} className="mt-5">
                <Link href={`/inscription?plan=${plan.key.toLowerCase()}`}>Essayer gratuitement</Link>
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {plan.trialDays} jours d'essai · sans carte bancaire
              </p>

              <ul className="mt-6 grid gap-3 border-t pt-6 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      {showComparison ? (
        <div className="mt-14 overflow-x-auto rounded-2xl border bg-card shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Comparatif détaillé des formules</caption>
            <thead>
              <tr className="border-b bg-muted/60">
                <th scope="col" className="px-6 py-4 text-left font-semibold">Fonctionnalités</th>
                {["Starter", "Pro", "Business"].map((name) => (
                  <th key={name} scope="col" className="px-4 py-4 text-center font-semibold">{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <th scope="row" className="px-6 py-3.5 text-left font-normal">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={index} className="px-4 py-3.5 text-center">
                      {value === true ? (
                        <CheckIcon className="mx-auto size-4 text-success-foreground" aria-label="Inclus" />
                      ) : value === false ? (
                        <MinusIcon className="mx-auto size-4 text-muted-foreground/50" aria-label="Non inclus" />
                      ) : (
                        <span className="font-medium">{value}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prix hors taxes, TVA en sus au taux en vigueur. Tarifs susceptibles d'évoluer ; le prix applicable est celui
        affiché au moment de la souscription.
      </p>
    </div>
  );
}
