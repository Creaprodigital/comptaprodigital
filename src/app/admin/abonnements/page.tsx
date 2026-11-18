import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listSubscriptions } from "@/server/modules/admin/users";
import { listAdminPlans } from "@/server/modules/admin/plans";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager, SUBSCRIPTION_STATUS, SubscriptionBadge } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Abonnements" };

type Props = { searchParams: Promise<{ status?: string; plan?: string; page?: string }> };

export default async function AdminSubscriptionsPage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const plans = await listAdminPlans();
  const status = params.status && params.status in SUBSCRIPTION_STATUS ? params.status : undefined;
  const plan = plans.some((p) => p.key === params.plan) ? params.plan : undefined;
  const result = await listSubscriptions({ status, plan, page: pageNumber(params.page) });
  return (
    <>
      <PageHeader title="Abonnements" description="Les abonnements payants sont gérés par Stripe ; les changements y sont répercutés par webhook." />
      <Card>
        <CardContent className="pt-6">
          <FilterBar
            action="/admin/abonnements"
            search={false}
            status={status}
            statuses={[{ value: "", label: "Tous les statuts" }, ...Object.entries(SUBSCRIPTION_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
            extra={
              <NativeSelect name="plan" defaultValue={plan ?? ""} className="h-9 w-48" aria-label="Filtrer par formule">
                <option value="">Toutes les formules</option>
                {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </NativeSelect>
            }
          />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Compte</TableHead><TableHead>Formule</TableHead><TableHead>Statut</TableHead><TableHead>Échéance</TableHead><TableHead className="text-right">Montant HT</TableHead><TableHead>Paiement</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {result.items.length === 0 ? <EmptyRow colSpan={6}>Aucun abonnement ne correspond.</EmptyRow> : null}
                {result.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Link href={`/admin/clients/${s.user.id}`} className="font-medium hover:underline">{s.user.name}</Link><span className="block text-xs text-muted-foreground">{s.user.email}</span></TableCell>
                    <TableCell>{s.plan} <span className="text-xs text-muted-foreground">({s.interval === "YEARLY" ? "annuel" : "mensuel"})</span></TableCell>
                    <TableCell><span className="flex flex-wrap gap-1"><SubscriptionBadge status={s.status} />{s.cancelAtPeriodEnd ? <Badge variant="outline">Résiliation programmée</Badge> : null}</span></TableCell>
                    <TableCell>{s.status === "TRIALING" && s.trialEndsAt ? `Essai jusqu'au ${formatDate(s.trialEndsAt)}` : s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(s.amount)}</TableCell>
                    <TableCell>{s.paymentFailedAt ? <Badge variant="destructive">Échec le {formatDate(s.paymentFailedAt)}</Badge> : s.stripe ? "Stripe" : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/abonnements" params={{ status, plan }} page={result.page} pageSize={result.pageSize} total={result.total} />
        </CardContent>
      </Card>
    </>
  );
}
