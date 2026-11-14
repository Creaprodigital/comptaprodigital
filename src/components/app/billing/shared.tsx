import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS, QUOTE_STATUS_LABELS } from "@/lib/invoicing";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BadgeVariant = "secondary" | "accent" | "success" | "warning" | "destructive" | "outline";

const INVOICE_VARIANTS: Record<keyof typeof INVOICE_STATUS_LABELS, BadgeVariant> = {
  DRAFT: "secondary",
  ISSUED: "accent",
  SENT: "accent",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "outline",
};

export function InvoiceStatusBadge({ status, overdue = false, type }: { status: keyof typeof INVOICE_STATUS_LABELS; overdue?: boolean; type?: keyof typeof INVOICE_TYPE_LABELS }) {
  if (overdue) return <Badge variant="destructive">En retard</Badge>;
  // Un avoir émis n'attend pas de règlement : « Émis » suffit.
  const label = type === "CREDIT_NOTE" && (status === "ISSUED" || status === "SENT") ? (status === "SENT" ? "Envoyé" : "Émis") : INVOICE_STATUS_LABELS[status];
  return <Badge variant={INVOICE_VARIANTS[status]}>{label}</Badge>;
}

const QUOTE_VARIANTS: Record<keyof typeof QUOTE_STATUS_LABELS, BadgeVariant> = {
  DRAFT: "secondary",
  SENT: "accent",
  ACCEPTED: "success",
  REJECTED: "destructive",
  EXPIRED: "warning",
  INVOICED: "success",
};

export function QuoteStatusBadge({ status }: { status: keyof typeof QUOTE_STATUS_LABELS }) {
  return <Badge variant={QUOTE_VARIANTS[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}

/** Recherche par formulaire GET : fonctionne sans JavaScript et conserve les filtres dans l'URL. */
export function SearchForm({ action, query, placeholder, hidden = {} }: { action: string; query?: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form action={action} method="get" role="search" className="flex w-full max-w-sm gap-2">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input name="q" type="search" defaultValue={query} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
      </div>
      <Button type="submit" variant="outline">Rechercher</Button>
    </form>
  );
}

export function FilterTabs({ basePath, current, options, query }: { basePath: string; current: string; options: Array<{ value: string; label: string }>; query?: string }) {
  return (
    <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
      {options.map((option) => {
        const params = new URLSearchParams();
        if (option.value !== "all") params.set("status", option.value);
        if (query) params.set("q", query);
        const href = params.size ? `${basePath}?${params}` : basePath;
        return (
          <Link
            key={option.value}
            href={href}
            aria-current={current === option.value ? "true" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pagination({ basePath, page, pageSize, total, params = {} }: { basePath: string; page: number; pageSize: number; total: number; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-4 text-sm text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</p>;
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    if (target > 1) search.set("page", String(target));
    return search.size ? `${basePath}?${search}` : basePath;
  };
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        {total} résultats — page {page} sur {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}><ChevronLeftIcon /> Précédent</Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Suivant <ChevronRightIcon /></Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function HistoryList({ entries }: { entries: Array<{ id: string; at: string; actor: string | null; detail: string | null; action: string }> }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Aucun événement.</p>;
  return (
    <ol className="grid gap-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative pl-5 text-sm">
          <span className="absolute top-1.5 left-0 size-2 rounded-full bg-primary" aria-hidden="true" />
          <p className="font-medium">{entry.detail ?? entry.action}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(entry.at)}
            {entry.actor ? ` · ${entry.actor}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
