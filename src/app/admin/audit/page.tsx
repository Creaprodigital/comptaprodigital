import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listAudit } from "@/server/modules/admin/audit";
import { auditQuery, type AuditQuery } from "@/lib/schemas/admin";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Pager } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Journal d'audit" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ACTORS = { USER: "Utilisateur", SUPER_ADMIN: "Administrateur", SYSTEM: "Système" } as const;

export default async function AdminAuditPage({ searchParams }: Props) {
  const [, raw] = await Promise.all([requireSuperAdmin(), searchParams]);
  const parsed = auditQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const filter: AuditQuery = parsed.success ? { ...parsed.data, format: undefined } : {};
  const result = await listAudit(filter);
  const params = Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, v === undefined ? undefined : String(v)]));
  const csv = `/api/v1/admin/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]) && e[0] !== "page")), format: "csv" })}`;
  return (
    <>
      <PageHeader
        title="Journal d'audit"
        description="Journal en ajout seul : connexions, modifications, actions de l'administration, accès justifiés. Il ne peut pas être modifié ni supprimé depuis l'interface."
        actions={<Button asChild variant="outline" size="sm"><a href={csv}><DownloadIcon /> Exporter (CSV)</a></Button>}
      />
      <Card>
        <CardContent className="pt-6">
          <form action="/admin/audit" method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
            <Input name="action" defaultValue={filter.action ?? ""} placeholder="Action (préfixe, ex. admin.)" className="h-9 w-56" aria-label="Action" />
            <NativeSelect name="actorType" defaultValue={filter.actorType ?? ""} className="h-9 w-44" aria-label="Acteur">
              <option value="">Tous les acteurs</option>
              {Object.entries(ACTORS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
            <Input name="companyId" defaultValue={filter.companyId ?? ""} placeholder="Identifiant d'entreprise" className="h-9 w-48" aria-label="Identifiant d'entreprise" />
            <Input name="userId" defaultValue={filter.userId ?? ""} placeholder="Identifiant d'utilisateur" className="h-9 w-48" aria-label="Identifiant d'utilisateur" />
            <Input name="from" type="date" defaultValue={filter.from ?? ""} className="h-9 w-40" aria-label="Du" />
            <Input name="to" type="date" defaultValue={filter.to ?? ""} className="h-9 w-40" aria-label="Au" />
            <Button type="submit" variant="outline" size="sm">Filtrer</Button>
          </form>
          {!parsed.success ? <p className="mb-4 text-sm text-destructive">Filtre invalide : il a été ignoré.</p> : null}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Action</TableHead><TableHead>Acteur</TableHead><TableHead>Entreprise</TableHead><TableHead>Détails</TableHead></TableRow></TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={5}>Aucune entrée.</EmptyRow> : null}
                {result.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell><code className="text-xs">{r.action}</code>{r.entity ? <span className="block text-xs text-muted-foreground">{r.entity}</span> : null}</TableCell>
                    <TableCell>
                      <Badge variant={r.actorType === "SUPER_ADMIN" ? "warning" : r.actorType === "SYSTEM" ? "secondary" : "outline"}>{ACTORS[r.actorType]}</Badge>
                      {r.user ? <span className="block text-xs">{r.userId ? <Link href={`/admin/clients/${r.userId}`} className="hover:underline">{r.user}</Link> : r.user}</span> : null}
                      {r.ip ? <span className="block text-xs text-muted-foreground">{r.ip}</span> : null}
                    </TableCell>
                    <TableCell>{r.company && r.companyId ? <Link href={`/admin/entreprises/${r.companyId}`} className="hover:underline">{r.company}</Link> : "—"}</TableCell>
                    <TableCell className="max-w-md"><code className="line-clamp-3 text-xs break-all text-muted-foreground">{r.metadata ? JSON.stringify(r.metadata) : ""}</code></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/audit" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
