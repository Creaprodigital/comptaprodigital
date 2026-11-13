import type { Metadata } from "next";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  CalendarClockIcon,
  ChartNoAxesCombinedIcon,
  ClockAlertIcon,
  HourglassIcon,
  LandmarkIcon,
  PercentIcon,
  ScaleIcon,
  WalletIcon,
} from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { getDashboard } from "@/server/modules/dashboard/service";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { KpiCard } from "@/components/app/dashboard/kpi-card";
import { AlertsList, ExpensesByCategory, LatestTransactions } from "@/components/app/dashboard/panels";
import { PeriodFilter } from "@/components/app/dashboard/period-filter";
import { RevenueExpensesChart } from "@/components/app/dashboard/revenue-expenses-chart";

export const metadata: Metadata = { title: "Tableau de bord" };

type Props = { searchParams: Promise<{ period?: string; from?: string; to?: string }> };

export default async function DashboardPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("dashboard:read"), searchParams]);
  const data = await getDashboard(access.company, { preset: params.period, from: params.from, to: params.to });
  const { kpis, currency } = data;
  const money = (value: string) => formatCurrency(value, { currency });
  const periodLabel = `du ${formatDate(data.range.from)} au ${formatDate(data.range.to)}`;
  const resultPositive = !kpis.periodResult.startsWith("-");

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={
          <>
            {access.company.name} · {data.fiscalYear.label} ({formatDate(data.fiscalYear.from)} – {formatDate(data.fiscalYear.to)})
          </>
        }
      />

      {data.isEmpty ? (
        <Alert className="mb-6">
          <ChartNoAxesCombinedIcon />
          <AlertTitle>Votre tableau de bord est prêt</AlertTitle>
          <AlertDescription>
            Aucune facture, aucun achat ni aucune opération bancaire n'est encore enregistré pour cette entreprise. Les
            indicateurs ci-dessous se rempliront automatiquement, à partir de vos données uniquement.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="period-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="period-title" className="text-lg font-semibold">Activité de la période</h2>
            <p className="text-sm text-muted-foreground">Période analysée : {periodLabel}</p>
          </div>
          <PeriodFilter preset={data.range.preset} from={data.range.from} to={data.range.to} today={data.today} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Recettes" value={money(kpis.periodRevenue)} hint="Chiffre d'affaires HT facturé, avoirs déduits" icon={BanknoteArrowUpIcon} tone="success" />
          <KpiCard label="Dépenses" value={money(kpis.periodExpenses)} hint="Achats et décaissements, hors taxes" icon={BanknoteArrowDownIcon} tone="warning" />
          <KpiCard
            label="Résultat estimé"
            value={money(kpis.periodResult)}
            hint={resultPositive ? "Recettes moins dépenses, avant impôts" : "Dépenses supérieures aux recettes sur la période"}
            icon={ScaleIcon}
            tone={resultPositive ? "default" : "danger"}
          />
          <KpiCard
            label="TVA estimée"
            value={kpis.periodVat ? money(kpis.periodVat.net) : "Non applicable"}
            hint={
              kpis.periodVat
                ? `Collectée ${money(kpis.periodVat.collected)} − déductible ${money(kpis.periodVat.deductible)}`
                : "Franchise en base : pas de TVA facturée"
            }
            icon={PercentIcon}
          />
        </div>
      </section>

      <section aria-labelledby="position-title" className="mt-8">
        <h2 id="position-title" className="text-lg font-semibold">Situation à ce jour</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            emphasis
            label="Trésorerie disponible"
            value={money(kpis.availableCash)}
            hint={`Solde bancaire − TVA à reverser (${money(kpis.vatProvision)}) − fournisseurs à payer (${money(kpis.supplierDebt)})`}
            icon={WalletIcon}
          />
          <KpiCard
            label="Solde bancaire"
            value={money(kpis.bankBalance)}
            hint={kpis.bankAccountCount > 0 ? `${kpis.bankAccountCount} compte${kpis.bankAccountCount > 1 ? "s" : ""} actif${kpis.bankAccountCount > 1 ? "s" : ""}` : "Aucun compte bancaire enregistré"}
            icon={LandmarkIcon}
          />
          <KpiCard label="Chiffre d'affaires du mois" value={money(kpis.revenueMonth)} hint="Mois civil en cours, hors taxes" icon={CalendarClockIcon} />
          <KpiCard label="Chiffre d'affaires annuel" value={money(kpis.revenueFiscalYear)} hint={`${data.fiscalYear.label}, hors taxes`} icon={ChartNoAxesCombinedIcon} />
          <KpiCard
            label="Factures impayées"
            value={money(kpis.unpaid.amount)}
            hint={`${kpis.unpaid.count} facture${kpis.unpaid.count > 1 ? "s" : ""} en attente de règlement (TTC)`}
            icon={HourglassIcon}
          />
          <KpiCard
            label="Factures en retard"
            value={money(kpis.overdue.amount)}
            hint={`${kpis.overdue.count} facture${kpis.overdue.count > 1 ? "s" : ""} dont l'échéance est dépassée`}
            icon={ClockAlertIcon}
            tone={kpis.overdue.count > 0 ? "danger" : "default"}
          />
        </div>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Évolution mensuelle des recettes et des dépenses</CardTitle>
            <CardDescription>Douze derniers mois, montants hors taxes</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueExpensesChart data={data.monthly} currency={currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertes et échéances</CardTitle>
            <CardDescription>Points d'attention calculés à partir de vos données</CardDescription>
          </CardHeader>
          <CardContent>
            <AlertsList items={data.alerts} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Répartition des dépenses par catégorie</CardTitle>
            <CardDescription>Période analysée : {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpensesByCategory items={data.expensesByCategory} currency={currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dernières opérations</CardTitle>
            <CardDescription>Mouvements bancaires les plus récents</CardDescription>
          </CardHeader>
          <CardContent>
            <LatestTransactions items={data.latestTransactions} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Indicateurs de gestion calculés à partir des données saisies, fournis à titre indicatif. Ils ne constituent ni des
        comptes annuels ni une déclaration fiscale et doivent être validés par un professionnel du chiffre.
      </p>
    </>
  );
}
