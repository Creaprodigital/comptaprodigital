import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listErrors } from "@/server/modules/admin/errors";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager } from "@/components/admin/ui";
import { ActionDialog } from "@/components/admin/action-dialog";

export const metadata: Metadata = { title: "Erreurs applicatives" };

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

export default async function AdminErrorsPage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const q = params.q?.trim().slice(0, 100) || undefined;
  const result = await listErrors({ q, page: pageNumber(params.page) });
  return (
    <>
      <PageHeader
        title="Erreurs applicatives"
        description="Erreurs inattendues (réponses 500) consignées par l'API et les webhooks. Les utilisateurs ne voient qu'un message générique."
        actions={<ActionDialog trigger="Purger (> 30 jours)" title="Supprimer les erreurs de plus de 30 jours ?" description="La purge est inscrite au journal d'audit." endpoint="/admin/errors" method="DELETE" destructive success="Erreurs anciennes supprimées." confirmLabel="Purger" />}
      />
      {result.topPaths7d.length > 0 ? (
        <Card className="mb-6">
          <CardHeader><CardTitle>Points de défaillance sur 7 jours</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">{result.topPaths7d.map((p) => <li key={p.path} className="flex justify-between gap-4"><code className="truncate">{p.path}</code><span className="tabular-nums">{p.count}</span></li>)}</ul>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <FilterBar action="/admin/erreurs" q={q} placeholder="Message, chemin…" />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Requête</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={3}>Aucune erreur enregistrée.</EmptyRow> : null}
                {result.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
                    <TableCell><code className="text-xs">{e.method} {e.path}</code></TableCell>
                    <TableCell><Link href={`/admin/erreurs/${e.id}`} className="line-clamp-2 hover:underline">{e.message}</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/erreurs" params={{ q }} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
