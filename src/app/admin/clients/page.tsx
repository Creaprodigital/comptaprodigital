import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listUsers } from "@/server/modules/admin/users";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager, SubscriptionBadge } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Comptes clients" };

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

export default async function AdminUsersPage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const q = params.q?.trim().slice(0, 100) || undefined;
  const status = params.status === "SUSPENDED" || params.status === "ADMIN" ? params.status : undefined;
  const result = await listUsers({ q, status, page: pageNumber(params.page) });
  return (
    <>
      <PageHeader title="Comptes clients" description="Identité, abonnement et entreprises rattachées. Aucune donnée comptable n'est affichée ici." />
      <Card>
        <CardContent className="pt-6">
          <FilterBar action="/admin/clients" q={q} status={status} placeholder="E-mail, nom…" statuses={[{ value: "", label: "Tous les comptes" }, { value: "SUSPENDED", label: "Suspendus" }, { value: "ADMIN", label: "Administrateurs" }]} />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Compte</TableHead><TableHead>Formule</TableHead><TableHead>Abonnement</TableHead><TableHead className="text-right">Entreprises</TableHead><TableHead>Inscription</TableHead><TableHead>Dernière connexion</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={6}>Aucun compte ne correspond.</EmptyRow> : null}
                {result.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/admin/clients/${u.id}`} className="font-medium hover:text-primary hover:underline">{u.name}</Link>
                      <span className="block text-xs text-muted-foreground">{u.email}</span>
                      <span className="mt-1 flex gap-1">
                        {u.status === "SUSPENDED" ? <Badge variant="destructive">Suspendu</Badge> : null}
                        {u.isSuperAdmin ? <Badge variant="warning">Administrateur</Badge> : null}
                        {!u.verified ? <Badge variant="outline">E-mail non vérifié</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell>{u.plan ?? "—"}</TableCell>
                    <TableCell><SubscriptionBadge status={u.subscriptionStatus} /></TableCell>
                    <TableCell className="text-right tabular-nums">{u.companies}</TableCell>
                    <TableCell>{formatDate(u.createdAt)}</TableCell>
                    <TableCell>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/clients" params={{ q, status }} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
