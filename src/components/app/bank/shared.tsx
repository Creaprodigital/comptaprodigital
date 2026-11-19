import Link from "next/link";
import { LockIcon } from "lucide-react";
import { TRANSACTION_STATUS_LABELS, type TransactionStatusKey } from "@/lib/bank";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_VARIANTS = { TO_REVIEW: "warning", CATEGORIZED: "accent", RECONCILED: "success" } as const;

export function TransactionStatusBadge({ status }: { status: TransactionStatusKey }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{TRANSACTION_STATUS_LABELS[status]}</Badge>;
}

/** Montant signé : les encaissements sont mis en valeur, les décaissements restent neutres. */
export function Amount({ value, currency, className }: { value: string; currency: string; className?: string }) {
  const positive = !value.startsWith("-") && Number(value) !== 0;
  return (
    <span className={cn("tabular font-semibold whitespace-nowrap", positive ? "text-success-foreground" : "text-foreground", className)}>
      {positive ? "+" : ""}
      {formatCurrency(value, { currency })}
    </span>
  );
}

export function CategoryChip({ category }: { category: { name: string; color: string | null } | null }) {
  if (!category) return <span className="text-sm text-muted-foreground">Sans catégorie</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-sm">
      <span className="size-2 shrink-0 rounded-full bg-primary" style={category.color ? { backgroundColor: category.color } : undefined} aria-hidden="true" />
      <span className="truncate">{category.name}</span>
    </span>
  );
}

/** Module absent de la formule de l'entreprise : aucune donnée n'est affichée. */
export function ModuleLocked({ title, description }: { title: string; description: string }) {
  return (
    <Alert variant="warning">
      <LockIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href="/tarifs">Comparer les formules</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Navigation secondaire du module bancaire. */
export function BankTabs({ current }: { current: "operations" | "comptes" | "import" | "regles" | "suggestions" }) {
  const tabs = [
    { key: "operations", label: "Opérations", href: "/app/banque" },
    { key: "comptes", label: "Comptes", href: "/app/banque/comptes" },
    { key: "import", label: "Import de relevés", href: "/app/banque/import" },
    { key: "regles", label: "Catégories et règles", href: "/app/banque/regles" },
    { key: "suggestions", label: "Suggestions IA", href: "/app/banque/suggestions" },
  ] as const;
  return (
    <nav aria-label="Sections de la banque" className="mb-6 flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            current === tab.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
