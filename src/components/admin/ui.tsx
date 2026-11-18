import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/** Composants serveur partagés par les pages de l'administration. */

export function StatCard({ label, value, hint, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Formulaire de filtre en GET : fonctionne sans JavaScript, l'URL reste partageable. */
export function FilterBar({
  action,
  q,
  status,
  statuses,
  placeholder = "Rechercher…",
  extra,
  search = true,
}: {
  action: string;
  search?: boolean;
  q?: string;
  status?: string;
  statuses?: Array<{ value: string; label: string }>;
  placeholder?: string;
  extra?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
      {search ? <Input name="q" defaultValue={q ?? ""} placeholder={placeholder} className="h-9 w-64" aria-label="Recherche" /> : null}
      {statuses ? (
        <NativeSelect name="status" defaultValue={status ?? ""} className="h-9 w-56" aria-label="Filtrer par statut">
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      {extra}
      <Button type="submit" variant="outline" size="sm">
        Filtrer
      </Button>
    </form>
  );
}

export function Pager({ basePath, params, page, pageSize, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</p>;
  const href = (p: number) => {
    const search = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => Boolean(e[1])));
    return `${basePath}?${search.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        {total} résultats — page {page} sur {pages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Précédente</Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Suivante</Link>
          </Button>
        ) : null}
      </span>
    </nav>
  );
}

export const SUBSCRIPTION_STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "accent" }> = {
  TRIALING: { label: "Essai", variant: "accent" },
  ACTIVE: { label: "Actif", variant: "success" },
  PAST_DUE: { label: "Impayé (grâce)", variant: "warning" },
  UNPAID: { label: "Impayé", variant: "destructive" },
  INCOMPLETE: { label: "Incomplet", variant: "warning" },
  CANCELED: { label: "Résilié", variant: "secondary" },
  EXPIRED: { label: "Expiré", variant: "secondary" },
};

export function SubscriptionBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">Aucun</Badge>;
  const s = SUBSCRIPTION_STATUS[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export const pageNumber = (value: string | undefined) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
};
