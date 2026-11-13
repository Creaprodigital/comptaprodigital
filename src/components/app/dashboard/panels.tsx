import { CircleAlertIcon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { DashboardAlert, DashboardData } from "@/server/modules/dashboard/service";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const MAX_CATEGORIES = 6;

/**
 * Répartition des dépenses : barres horizontales classées, une seule teinte
 * (comparaison de grandeurs), montant et part affichés en clair sur chaque ligne.
 */
export function ExpensesByCategory({ items, currency }: { items: DashboardData["expensesByCategory"]; currency: string }) {
  if (items.length === 0) {
    return <EmptyPanel>Aucune dépense enregistrée sur la période.</EmptyPanel>;
  }
  const head = items.slice(0, MAX_CATEGORIES);
  const tail = items.slice(MAX_CATEGORIES);
  const rows = tail.length
    ? [...head, { name: `Autres (${tail.length})`, color: null, amount: tail.reduce((acc, item) => acc + Number(item.amount), 0).toFixed(2) }]
    : head;
  const total = items.reduce((acc, item) => acc + Number(item.amount), 0);
  const max = Math.max(...rows.map((row) => Number(row.amount)));

  return (
    <ul className="grid gap-4">
      {rows.map((row) => {
        const amount = Number(row.amount);
        const share = total > 0 ? Math.round((amount / total) * 100) : 0;
        return (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="truncate font-medium">{row.name}</span>
              <span className="tabular shrink-0">
                <span className="font-semibold">{formatCurrency(row.amount, { currency })}</span>
                <span className="ml-2 text-xs text-muted-foreground">{share} %</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-chart-track" aria-hidden="true">
              <div className="h-full rounded-full bg-chart-expenses" style={{ width: `${max > 0 ? Math.max(2, (amount / max) * 100) : 0}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const TRANSACTION_STATUS: Record<string, { label: string; variant: "warning" | "accent" | "success" }> = {
  TO_REVIEW: { label: "À catégoriser", variant: "warning" },
  CATEGORIZED: { label: "Catégorisée", variant: "accent" },
  RECONCILED: { label: "Rapprochée", variant: "success" },
};

export function LatestTransactions({ items, currency }: { items: DashboardData["latestTransactions"]; currency: string }) {
  if (items.length === 0) {
    return <EmptyPanel>Aucune opération bancaire enregistrée.</EmptyPanel>;
  }
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const inflow = !item.amount.startsWith("-");
        const status = TRANSACTION_STATUS[item.status];
        return (
          <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.label}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <time dateTime={item.date}>{formatDate(item.date)}</time>
                <span aria-hidden="true">·</span>
                <span className="truncate">{item.categoryName ?? "Sans catégorie"}</span>
                {status ? <Badge variant={status.variant} className="px-2 py-0 text-[11px]">{status.label}</Badge> : null}
              </p>
            </div>
            <p className={cn("tabular shrink-0 text-sm font-semibold", inflow && "text-success-foreground")}>
              {inflow ? "+" : ""}
              {formatCurrency(item.amount, { currency })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const ALERT_STYLES: Record<DashboardAlert["level"], { icon: LucideIcon; label: string; classes: string }> = {
  danger: { icon: CircleAlertIcon, label: "Urgent", classes: "bg-destructive-soft text-destructive-foreground" },
  warning: { icon: TriangleAlertIcon, label: "À traiter", classes: "bg-warning-soft text-warning-foreground" },
  info: { icon: InfoIcon, label: "Information", classes: "bg-accent text-accent-foreground" },
};

export function AlertsList({ items }: { items: DashboardAlert[] }) {
  if (items.length === 0) {
    return <EmptyPanel>Aucune alerte : tout est à jour.</EmptyPanel>;
  }
  return (
    <ul className="grid gap-3">
      {items.map((alert) => {
        const style = ALERT_STYLES[alert.level];
        return (
          <li key={alert.id} className="flex gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", style.classes)}>
              <style.icon className="size-4" aria-hidden="true" />
              <span className="sr-only">{style.label} :</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm leading-snug font-semibold">{alert.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{alert.description}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
