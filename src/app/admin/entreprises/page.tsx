import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listCompanies } from "@/server/modules/admin/companies";
import { formatDate, formatSiren } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Entreprises" };

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

const STATUS: Record<string, { label: string; variant: "success" | "destructive" | "secondary" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  SUSPENDED: { label: "Suspendue", variant: "destructive" },
  ARCHIVED: { label: "Archivée", variant: "secondary" },
};

export default async function AdminCompaniesPage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const q = params.q?.trim().slice(0, 100) || undefined;
  const status = params.status && params.status in STATUS ? params.status : undefined;
  const result = await listCompanies({ q, status, page: pageNumber(params.page) });
  return (
    <>
      <PageHeader title="Entreprises" description="Identité et statut des entreprises. Leurs données comptables ne sont consultables que sur accès justifié." />
      <Card>
        <CardContent className="pt-6">
          <FilterBar action="/admin/entreprises" q={q} status={status} placeholder="Nom, SIREN, e-mail du créateur…" statuses={[{ value: "", label: "Tous les statuts" }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Entreprise</TableHead><TableHead>SIREN</TableHead><TableHead>Créée par</TableHead><TableHead className="text-right">Membres</TableHead><TableHead>Statut</TableHead><TableHead>Création</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={6}>Aucune entreprise ne correspond.</EmptyRow> : null}
                {result.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Link href={`/admin/entreprises/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link></TableCell>
                    <TableCell className="tabular-nums">{c.siren ? formatSiren(c.siren) : "—"}</TableCell>
                    <TableCell>{c.createdBy ? <Link href={`/admin/clients/${c.createdBy.id}`} className="hover:underline">{c.createdBy.email}</Link> : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.members}</TableCell>
                    <TableCell><Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge></TableCell>
                    <TableCell>{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/entreprises" params={{ q, status }} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
