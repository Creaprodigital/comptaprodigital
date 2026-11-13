"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarRangeIcon } from "lucide-react";
import { PERIOD_LABELS, type PeriodPreset } from "@/server/modules/dashboard/periods";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS: PeriodPreset[] = ["7d", "30d", "quarter", "year"];

/** Filtres de période : liens pour les périodes prédéfinies, formulaire GET pour une période personnalisée. */
export function PeriodFilter({ preset, from, to, today }: { preset: PeriodPreset; from: string; to: string; today: string }) {
  const [customOpen, setCustomOpen] = useState(preset === "custom");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Période d'analyse" className="inline-flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
        {PRESETS.map((value) => (
          <Link
            key={value}
            href={`/app/tableau-de-bord?period=${value}`}
            scroll={false}
            aria-current={preset === value ? "true" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              preset === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {PERIOD_LABELS[value]}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          aria-expanded={customOpen}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            preset === "custom" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <CalendarRangeIcon className="size-4" aria-hidden="true" />
          {PERIOD_LABELS.custom}
        </button>
      </div>

      {customOpen ? (
        <form action="/app/tableau-de-bord" method="get" className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-2 shadow-xs">
          <input type="hidden" name="period" value="custom" />
          <div className="grid gap-1">
            <Label htmlFor="period-from" className="text-xs text-muted-foreground">Du</Label>
            <Input id="period-from" type="date" name="from" defaultValue={from} max={today} required className="h-9 w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="period-to" className="text-xs text-muted-foreground">Au</Label>
            <Input id="period-to" type="date" name="to" defaultValue={to} required className="h-9 w-40" />
          </div>
          <Button type="submit" size="sm" className="h-9">Appliquer</Button>
        </form>
      ) : null}
    </div>
  );
}
