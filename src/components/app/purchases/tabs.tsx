import Link from "next/link";
import { cn } from "@/lib/utils";

export function PurchasesTabs({ current }: { current: "factures" | "fournisseurs" }) {
  const tabs = [
    { key: "factures", label: "Factures d'achat", href: "/app/achats" },
    { key: "fournisseurs", label: "Fournisseurs", href: "/app/achats/fournisseurs" },
  ] as const;
  return (
    <nav aria-label="Sections des achats" className="mb-6 flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
      {tabs.map((tab) => (
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
