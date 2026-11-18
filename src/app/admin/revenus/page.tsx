import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/server/admin/guard";
import { saasMetrics } from "@/server/modules/admin/metrics";
import { listPayments } from "@/server/modules/admin/users";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, FilterBar, pageNumber, Pager, StatCard } from "@/components/admin/ui";
import { RevenueChart } from "@/components/admin/revenue-chart";

export const metadata: Metadata = { title: "Revenus" };

type Props = { searchParams: Promise<{ status?: string; page?: string }> };

const PAYMENT_STATUS: Record<string, { label: string; variant: "success" | "destructive" | "secondary" | "warning" }> = {
  paid: { label: "Payée", variant: "success" },
  open: { label: "En attente", variant: "warning" },
  failed: { label: "Échec", variant: "destructive" },
  void: { label: "Annulée", variant: "secondary" },
  uncollectible: { label: "Irrécouvrable", variant: "destructive" },
};

export default async function RevenuePage({ searchParams }: Props) {
  const [, params] = await Promise.all([requireSuperAdmin(), searchParams]);
  const page = pageNumber(params.page);
  const status = params.status && params.status in PAYMENT_STATUS ? params.status : undefined;
  const [m, payments] = await Promise.all([saasMetrics(), listPayments({ status, page })]);
  return (
    <>
      <PageHeader title="Revenus" description="Factures d'abonnement émises par Stripe et enregistrées à réception des webhooks." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="MRR" value={formatCurrency(m.mrr)} />
        <StatCard label="ARR" value={formatCurrency(m.arr)} />
        <StatCard label="Encaissé sur 12 mois" value={formatCurrency(m.revenue12m)} />
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Encaissements mensuels</CardTitle></CardHeader>
        <CardContent><RevenueChart data={m.revenueByMonth} /></CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader><CardTitle>Factures d'abonnement</CardTitle></CardHeader>
        <CardContent>
          <FilterBar action="/admin/revenus" status={status} statuses={[{ value: "", label: "Tous les statuts" }, ...Object.entries(PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))]} search={false} />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Compte</TableHead><TableHead>Formule</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Montant TTC</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {payments.items.length === 0 ? <EmptyRow colSpan={6}>Aucune facture d'abonnement enregistrée.</EmptyRow> : null}
                {payments.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDateTime(p.date)}</TableCell>
                    <TableCell><Link href={`/admin/clients/${p.user.id}`} className="hover:underline">{p.user.email}</Link></TableCell>
                    <TableCell>{p.plan}</TableCell>
                    <TableCell><Badge variant={PAYMENT_STATUS[p.status]?.variant ?? "secondary"}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(p.amount, { currency: p.currency.toUpperCase() })}</TableCell>
                    <TableCell className="text-right">{p.hostedInvoiceUrl ? <a href={p.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Facture</a> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager basePath="/admin/revenus" params={{ status }} page={payments.page} pageSize={payments.pageSize} total={payments.total} />
        </CardContent>
      </Card>
    </>
  );
}
