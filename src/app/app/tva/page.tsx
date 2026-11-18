import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClockIcon, InfoIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listVatPeriods, vatSimulation } from "@/server/modules/vat/service";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { ModuleLocked } from "@/components/app/bank/shared";
import { EmptyState } from "@/components/app/billing/shared";
import { VatStatusBadge } from "@/components/app/vat/shared";

export const metadata: Metadata = { title: "TVA" };

type Props = { searchParams: Promise<{ annee?: string }> };

const REGIMES = { FRANCHISE: "Franchise en base", REEL_SIMPLIFIE: "Réel simplifié (CA12)", REEL_NORMAL_MENSUEL: "Réel normal, déclaration mensuelle (CA3)", REEL_NORMAL_TRIMESTRIEL: "Réel normal, déclaration trimestrielle (CA3)" } as const;

export default async function VatPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("vat:read"), searchParams]);
  const company = access.company;
  if (!(await companyHasModule(company.id, "vat"))) {
    return (
      <>
        <PageHeader title="TVA" description="Suivi de la TVA collectée et déductible, préparation des déclarations." />
        <ModuleLocked title="Le suivi de la TVA fait partie de la formule Pro" description="Suivez votre TVA collectée et déductible et préparez vos déclarations en passant à la formule Pro." />
      </>
    );
  }
  if (company.vatRegime === "FRANCHISE") {
    return (
      <>
        <PageHeader title="TVA" description={REGIMES.FRANCHISE} />
        <EmptyState title="Votre entreprise ne facture pas la TVA" description="En franchise en base, vos factures portent la mention « TVA non applicable, art. 293 B du CGI » et vous ne déposez pas de déclaration de TVA. En cas de dépassement des seuils, modifiez le régime dans les paramètres de l'entreprise." />
      </>
    );
  }
  const [list, simulation] = await Promise.all([listVatPeriods(access, Number(params.annee) || undefined), vatSimulation(access)]);
  const currency = company.currency;
  const money = (v: string) => formatCurrency(v, { currency });

  return (
    <>
      <PageHeader title="TVA" description={REGIMES[company.vatRegime]} />
      <Alert className="mb-6">
        <InfoIcon />
        <AlertTitle>Préparation, pas télétransmission</AlertTitle>
        <AlertDescription>
          ComptaPro Digital calcule et prépare vos déclarations à partir de vos factures, achats et opérations bancaires. Rien n'est transmis automatiquement : après vérification, vous reportez les montants sur votre espace professionnel impots.gouv.fr. Faites valider les règles de calcul par un professionnel pour les situations particulières (opérations intracommunautaires, autoliquidation, prorata de déduction…), qui ne sont pas prises en charge.
        </AlertDescription>
      </Alert>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {simulation.current ? (
          <Card>
            <CardHeader>
              <CardTitle>Période en cours — {simulation.current.label}</CardTitle>
              <CardDescription>Simulation à ce jour, à partir des opérations déjà enregistrées.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">TVA collectée</dt><dd className="tabular font-medium">{money(simulation.current.collected)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">TVA déductible</dt><dd className="tabular font-medium">{money(simulation.current.deductible)}</dd></div>
                <div className="flex justify-between border-t pt-2"><dt className="font-medium">{Number(simulation.current.netVatDue) >= 0 ? "TVA à payer (estimation)" : "Crédit de TVA (estimation)"}</dt><dd className="tabular font-display text-xl font-bold">{money(simulation.current.netVatDue.replace("-", ""))}</dd></div>
              </dl>
              {simulation.installments ? (
                <div className="mt-4 rounded-xl border bg-muted/60 px-4 py-3 text-sm">
                  <p className="font-medium">Acomptes du régime simplifié</p>
                  <p className="text-muted-foreground">{simulation.installments.source}</p>
                  {Number(simulation.installments.july) > 0 ? <p className="mt-1">Juillet (55 %) : <span className="tabular font-semibold">{money(simulation.installments.july)}</span> · Décembre (40 %) : <span className="tabular font-semibold">{money(simulation.installments.december)}</span></p> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {simulation.deadline ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarClockIcon className="size-5 text-primary" aria-hidden="true" /> Prochaine échéance</CardTitle>
              <CardDescription>{simulation.deadline.title}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">Du {formatDate(simulation.deadline.windowStart)} au {formatDate(simulation.deadline.windowEnd)}</p>
              <p className="mt-1 text-muted-foreground">{simulation.deadline.description}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Déclarations {list.year}</h2>
        {list.years.length > 1 ? (
          <form method="get" action="/app/tva" className="flex gap-2">
            <NativeSelect name="annee" defaultValue={String(list.year)} className="h-9 w-28" aria-label="Année">{list.years.map((y) => <option key={y} value={y}>{y}</option>)}</NativeSelect>
            <Button type="submit" variant="outline" size="sm" className="h-9">Afficher</Button>
          </form>
        ) : null}
      </div>
      {list.periods.length === 0 ? (
        <EmptyState title="Aucune période" description="Aucune période de déclaration sur cette année." />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Période</TableHead><TableHead className="hidden md:table-cell">Échéance</TableHead><TableHead className="hidden sm:table-cell text-right">Collectée</TableHead><TableHead className="hidden sm:table-cell text-right">Déductible</TableHead><TableHead className="text-right">Solde</TableHead><TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.periods.map((p) => (
                  <TableRow key={p.startDate}>
                    <TableCell>
                      <Link href={`/app/tva/${p.startDate}`} className="font-medium hover:text-primary hover:underline">{p.label}</Link>
                      <p className="text-xs text-muted-foreground">{p.formType}{p.outdated ? " · opérations modifiées depuis la validation" : ""}</p>
                    </TableCell>
                    <TableCell className="tabular hidden text-muted-foreground md:table-cell">{formatDate(p.dueDate)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{money(p.collected)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{money(p.deductible)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{Number(p.netVatDue) < 0 ? `Crédit ${money(p.netVatDue.replace("-", ""))}` : money(p.netVatDue)}</TableCell>
                    <TableCell><VatStatusBadge status={p.status} ended={p.ended} current={p.current} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
