import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listTickets } from "@/server/modules/support/service";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager } from "@/components/admin/ui";
import { PRIORITY_LABELS, STAFF_STATUS_LABELS } from "@/components/admin/labels";

export const metadata: Metadata = { title: "Support" };

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

export default async function AdminSupportPage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const q = params.q?.trim().slice(0, 100) || undefined;
  const status = params.status === "all" ? undefined : params.status && params.status in STAFF_STATUS_LABELS ? (params.status as "OPEN") : "active";
  const result = await listTickets({ status, q, page: pageNumber(params.page) });
  return (
    <>
      <PageHeader title="Support" description="Demandes envoyées depuis l'espace client et le formulaire de contact. Les réponses sont envoyées par e-mail et visibles dans l'espace client." />
      <Card>
        <CardContent className="pt-6">
          <FilterBar
            action="/admin/support"
            q={q}
            status={params.status ?? ""}
            placeholder="Référence, objet, e-mail…"
            statuses={[{ value: "", label: "À traiter" }, { value: "all", label: "Toutes" }, ...Object.entries(STAFF_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
          />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Demande</TableHead><TableHead>Demandeur</TableHead><TableHead>Statut</TableHead><TableHead>Priorité</TableHead><TableHead>Mise à jour</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={5}>Aucune demande.</EmptyRow> : null}
                {result.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell><Link href={`/admin/support/${t.id}`} className="font-medium hover:text-primary hover:underline">{t.subject}</Link><span className="block text-xs text-muted-foreground">{t.reference} · {t.source === "CONTACT_FORM" ? "Formulaire de contact" : "Espace client"}</span></TableCell>
                    <TableCell>{t.requester.name}<span className="block text-xs text-muted-foreground">{t.requester.email}</span></TableCell>
                    <TableCell><Badge variant={t.status === "OPEN" ? "accent" : t.status === "IN_PROGRESS" ? "warning" : "secondary"}>{STAFF_STATUS_LABELS[t.status]}</Badge></TableCell>
                    <TableCell><Badge variant={t.priority === "URGENT" ? "destructive" : t.priority === "HIGH" ? "warning" : "outline"}>{PRIORITY_LABELS[t.priority]}</Badge></TableCell>
                    <TableCell>{formatDateTime(t.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/support" params={{ q, status: params.status }} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
