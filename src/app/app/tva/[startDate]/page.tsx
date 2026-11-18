import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon, DownloadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { companyHasModule } from "@/server/modules/plans/service";
import { getVatPeriod } from "@/server/modules/vat/service";
import { VAT_OPERATION_LABELS } from "@/server/modules/vat/compute";
import { isIsoDate } from "@/lib/dates";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HistoryList } from "@/components/app/billing/shared";
import { VatPeriodActions } from "@/components/app/vat/vat-actions";
import { VatStatusBadge } from "@/components/app/vat/shared";

export const metadata: Metadata = { title: "Déclaration de TVA" };
export const instant = false;

type Props = { params: Promise<{ startDate: string }> };
const NATURES = { COLLECTED: "Collectée", DEDUCTIBLE: "Déductible", DEDUCTIBLE_ASSETS: "Déductible (immobilisation)" } as const;

export default async function VatPeriodPage({ params }: Props) {
  const [{ access }, { startDate }] = await Promise.all([requireCompany("vat:read"), params]);
  if (!(await companyHasModule(access.company.id, "vat")) || access.company.vatRegime === "FRANCHISE") redirect("/app/tva");
  if (!isIsoDate(startDate)) notFound();
  const detail = await getVatPeriod(access, startDate).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const { period, computation, snapshot } = detail;
  const money = (v: string) => formatCurrency(v, { currency: access.company.currency });
  const shown = snapshot ?? { collected: computation.collected, deductibleGoodsServices: computation.deductibleGoodsServices, deductibleAssets: computation.deductibleAssets, creditCarriedOver: period.creditCarriedOver, netVatDue: period.netVatDue };
  const net = Number(shown.netVatDue);
  const check = detail.accountingCheck;
  const concordant = check && check.collected === computation.collected && check.deductible === computation.deductible;

  return (
    <>
      <Link href="/app/tva" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> TVA
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Déclaration {period.formType} — {period.label}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Du {formatDate(period.startDate)} au {formatDate(period.endDate)} · dépôt au plus tard le {formatDate(period.dueDate)} (date indicative)</span>
            <VatStatusBadge status={period.status} ended={period.ended} current={period.current} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.permissions.has("exports:run") ? <Button asChild variant="outline"><a href={`/api/v1/companies/${access.company.id}/vat/periods/${period.startDate}/export`} download><DownloadIcon /> Détail (CSV)</a></Button> : null}
          <VatPeriodActions companyId={access.company.id} startDate={period.startDate} status={period.status} ended={period.ended} canWrite={access.permissions.has("vat:write")} canValidate={access.permissions.has("vat:validate")} />
        </div>
      </div>
      {!period.ended ? (
        <Alert className="mb-4"><AlertTriangleIcon /><AlertTitle>Période en cours</AlertTitle><AlertDescription>Les montants évoluent jusqu'à la fin de la période ; la déclaration pourra être préparée ensuite.</AlertDescription></Alert>
      ) : null}
      {period.outdated ? (
        <Alert variant="warning" className="mb-4"><AlertTriangleIcon /><AlertTitle>Des opérations de la période ont changé</AlertTitle><AlertDescription>Les montants figés ci-dessous ne correspondent plus aux opérations enregistrées ({money(computation.collected)} collectés, {money(computation.deductible)} déductibles). {period.status === "DECLARED" ? "La déclaration étant déposée, l'écart se régularise sur une prochaine déclaration." : "Rouvrez et préparez à nouveau la déclaration avant de la déposer."}</AlertDescription></Alert>
      ) : null}
      {period.status === "VALIDATED" ? (
        <Alert variant="warning" className="mb-4"><AlertTriangleIcon /><AlertTitle>À déposer sur votre espace professionnel</AlertTitle><AlertDescription>Reportez ces montants sur impots.gouv.fr, puis indiquez ici le dépôt. La plateforme ne transmet rien à l'administration.</AlertDescription></Alert>
      ) : null}
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{net >= 0 ? `TVA nette due : ${money(shown.netVatDue)}` : `Crédit de TVA : ${money(shown.netVatDue.replace("-", ""))}`}</CardTitle>
              <CardDescription>{snapshot ? `Montants figés le ${formatDateTime(snapshot.validatedAt ?? snapshot.preparedAt!)}.` : "Montants calculés à partir des opérations enregistrées."}</CardDescription>
            </CardHeader>
            <CardContent className="px-2 pb-2 sm:px-4">
              {detail.form.length > 0 ? (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-14">Ligne</TableHead><TableHead>Rubrique</TableHead><TableHead className="hidden sm:table-cell text-right">Base HT</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.form.map((row) => (
                      <TableRow key={`${row.line}-${row.label}`}>
                        <TableCell className="tabular font-medium">{row.line}</TableCell>
                        <TableCell className="text-sm">{row.label}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{row.base ? money(row.base) : ""}</TableCell>
                        <TableCell className="tabular text-right font-medium">{money(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <dl className="grid gap-2 px-2 py-2 text-sm">
                  {computation.collectedByRate.map((r) => <div key={r.rate} className="flex justify-between"><dt>TVA collectée à {r.rate.replace(".", ",")} % (base {money(r.base)})</dt><dd className="tabular font-medium">{money(r.vat)}</dd></div>)}
                  <div className="flex justify-between"><dt>TVA déductible — biens et services</dt><dd className="tabular font-medium">{money(shown.deductibleGoodsServices)}</dd></div>
                  <div className="flex justify-between"><dt>TVA déductible — immobilisations</dt><dd className="tabular font-medium">{money(shown.deductibleAssets)}</dd></div>
                  <div className="flex justify-between"><dt>Crédit antérieur imputé</dt><dd className="tabular font-medium">{money(shown.creditCarriedOver)}</dd></div>
                </dl>
              )}
              <p className="px-2 py-3 text-xs text-muted-foreground">Les numéros de ligne renvoient au formulaire n° 3310-CA3 ; vérifiez-les sur le formulaire en vigueur au moment du dépôt.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Opérations retenues</CardTitle><CardDescription>{computation.operations.length} opération{computation.operations.length > 1 ? "s" : ""}, avec la règle d'exigibilité appliquée à chacune.</CardDescription></CardHeader>
            <CardContent className="px-2 pb-2 sm:px-4">
              {computation.operations.length === 0 ? <p className="px-2 py-4 text-sm text-muted-foreground">Aucune opération soumise à la TVA sur cette période.</p> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Date</TableHead><TableHead>Opération</TableHead><TableHead className="hidden md:table-cell">Nature</TableHead><TableHead className="hidden sm:table-cell text-right">Base HT</TableHead><TableHead className="text-right">TVA</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {computation.operations.map((o, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(o.date)}</TableCell>
                        <TableCell className="max-w-[18rem]">
                          {o.href ? <Link href={o.href} className="block truncate font-medium hover:text-primary hover:underline">{VAT_OPERATION_LABELS[o.kind]} {o.reference}</Link> : <span className="font-medium">{VAT_OPERATION_LABELS[o.kind]} {o.reference}</span>}
                          <p className="truncate text-xs text-muted-foreground">{o.label}{o.rate ? ` · ${o.rate.replace(".", ",")} %` : ""}</p>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">{NATURES[o.nature]}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{money(o.base)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{money(o.vat)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6">
          {check ? (
            <Card>
              <CardHeader><CardTitle>Concordance avec la comptabilité</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <p className="flex items-center gap-2">{concordant ? <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden="true" /> : <AlertTriangleIcon className="size-4 text-warning-foreground" aria-hidden="true" />}{concordant ? "Les comptes de TVA concordent avec le calcul." : "Écart entre les comptes de TVA et le calcul."}</p>
                <p className="mt-2 text-muted-foreground">Compte 445710 : {money(check.collected)} · comptes 44566 et 44562 : {money(check.deductible)} (brouillard compris).</p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent><HistoryList entries={detail.history} /></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
