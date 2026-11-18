import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, BadgeEuroIcon, Building2Icon, LifeBuoyIcon, TrendingUpIcon, UsersIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { saasMetrics } from "@/server/modules/admin/metrics";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/admin/ui";
import { RevenueChart } from "@/components/admin/revenue-chart";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default async function AdminOverviewPage() {
  await requireSuperAdmin();
  const m = await saasMetrics();
  return (
    <>
      <PageHeader title="Vue d'ensemble" description="Indicateurs calculés à partir des abonnements et des paiements enregistrés (montants HT)." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={TrendingUpIcon} label="MRR" value={formatCurrency(m.mrr)} hint={`${m.payingSubscribers} abonnement(s) payant(s)${m.pastDue ? `, dont ${m.pastDue} en impayé` : ""}`} />
        <StatCard icon={BadgeEuroIcon} label="ARR" value={formatCurrency(m.arr)} hint="MRR × 12" />
        <StatCard icon={UsersIcon} label="Comptes" value={m.users} hint={`${m.signups30d} inscription(s) sur 30 jours · ${m.trialing} en essai`} />
        <StatCard icon={Building2Icon} label="Entreprises" value={m.companies} hint={`${m.canceled30d} résiliation(s) sur 30 jours`} />
      </div>
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Encaissements des 12 derniers mois</CardTitle>
            <CardDescription>Factures d'abonnement payées : {formatCurrency(m.revenue12m)} au total.</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={m.revenueByMonth} />
          </CardContent>
        </Card>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Répartition par formule</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {m.byPlan.map((p) => (
                  <li key={p.key} className="flex items-center justify-between py-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {p.subscribers} payant(s) · {formatCurrency(p.mrr)}/mois
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>À traiter</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Link href="/admin/support" className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="flex items-center gap-2"><LifeBuoyIcon className="size-4" aria-hidden="true" /> Demandes de support ouvertes</span>
                <span className="font-semibold tabular-nums">{m.openTickets}</span>
              </Link>
              <Link href="/admin/erreurs" className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="flex items-center gap-2"><AlertTriangleIcon className="size-4" aria-hidden="true" /> Erreurs sur 24 heures</span>
                <span className="font-semibold tabular-nums">{m.errors24h}</span>
              </Link>
              <Link href="/admin/abonnements?status=PAST_DUE" className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="flex items-center gap-2"><BadgeEuroIcon className="size-4" aria-hidden="true" /> Abonnements impayés</span>
                <span className="font-semibold tabular-nums">{m.pastDue}</span>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
