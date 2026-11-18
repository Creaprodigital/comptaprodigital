import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

export const ACCOUNTING_SECTIONS = [
  { key: "apercu", label: "Vue d'ensemble", href: "/app/comptabilite" },
  { key: "ecritures", label: "Écritures", href: "/app/comptabilite/ecritures" },
  { key: "grand-livre", label: "Grand livre", href: "/app/comptabilite/grand-livre" },
  { key: "balance", label: "Balance", href: "/app/comptabilite/balance" },
  { key: "tiers", label: "Clients et fournisseurs", href: "/app/comptabilite/tiers" },
  { key: "rapprochement", label: "Rapprochement", href: "/app/comptabilite/rapprochement" },
  { key: "immobilisations", label: "Immobilisations", href: "/app/comptabilite/immobilisations" },
  { key: "exercices", label: "Exercices et exports", href: "/app/comptabilite/exercices" },
  { key: "plan-comptable", label: "Plan comptable", href: "/app/comptabilite/plan-comptable" },
] as const;

export type AccountingSection = (typeof ACCOUNTING_SECTIONS)[number]["key"];

export function AccountingTabs({ current }: { current: AccountingSection }) {
  return (
    <nav aria-label="Sections de la comptabilité" className="mb-6 flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
      {ACCOUNTING_SECTIONS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", current === tab.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function EntryStatusBadge({ status }: { status: "DRAFT" | "VALIDATED" }) {
  return status === "DRAFT" ? <Badge variant="warning">Brouillard</Badge> : <Badge variant="success">Validée</Badge>;
}

/** Montant comptable : vide si nul, pour des colonnes débit/crédit lisibles. */
export function Amount({ value, currency = "EUR", strong = false }: { value: string; currency?: string; strong?: boolean }) {
  if (Number(value) === 0) return <span className="text-muted-foreground/60">—</span>;
  return <span className={cn("tabular whitespace-nowrap", strong && "font-semibold")}>{formatCurrency(value, { currency })}</span>;
}

/** Filtre de période des états (formulaire GET : fonctionne sans JavaScript). */
export function PeriodFilter({
  action,
  fiscalYears,
  fiscalYearId,
  from,
  to,
  includeDrafts,
  children,
}: {
  action: string;
  fiscalYears: Array<{ id: string; label: string }>;
  fiscalYearId: string;
  from: string;
  to: string;
  includeDrafts: boolean;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-xs">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Exercice
        <NativeSelect name="exercice" defaultValue={fiscalYearId} className="h-9 w-44">
          {fiscalYears.map((y) => (
            <option key={y.id} value={y.id}>{y.label}</option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Du
        <Input type="date" name="du" defaultValue={from} className="h-9 w-40" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Au
        <Input type="date" name="au" defaultValue={to} className="h-9 w-40" />
      </label>
      {children}
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="brouillard" value="exclure" defaultChecked={!includeDrafts} className="size-4 accent-primary" />
        Écritures validées uniquement
      </label>
      <Button type="submit" variant="outline" size="sm" className="h-9">Afficher</Button>
    </form>
  );
}

/** Paramètres d'URL communs aux états. */
export function reportParams(params: { exercice?: string; du?: string; au?: string; brouillard?: string; compte?: string; journal?: string }) {
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    fiscalYearId: params.exercice?.slice(0, 40) || undefined,
    from: iso(params.du),
    to: iso(params.au),
    includeDrafts: params.brouillard !== "exclure",
    account: params.compte?.replace(/\D/g, "").slice(0, 10) || undefined,
    journalId: params.journal?.slice(0, 40) || undefined,
  };
}

export function exportQuery(filter: { fiscalYearId?: string; from?: string; to?: string; includeDrafts: boolean; account?: string; journalId?: string }) {
  const search = new URLSearchParams({ format: "csv" });
  if (filter.fiscalYearId) search.set("fiscalYearId", filter.fiscalYearId);
  if (filter.from) search.set("from", filter.from);
  if (filter.to) search.set("to", filter.to);
  if (!filter.includeDrafts) search.set("drafts", "exclude");
  if (filter.account) search.set("account", filter.account);
  if (filter.journalId) search.set("journalId", filter.journalId);
  return search.toString();
}
