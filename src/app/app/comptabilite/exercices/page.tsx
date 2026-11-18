import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DownloadIcon, InfoIcon } from "lucide-react";
import { listFiscalYears } from "@/server/modules/accounting/closing";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { addDays, todayInParis } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { AccountingTabs } from "@/components/app/accounting/shared";
import { CloseYearButton, LockPeriodForm, NextYearButton } from "@/components/app/accounting/fiscal-years-view";

export const metadata: Metadata = { title: "Exercices et exports" };

export default async function FiscalYearsPage() {
  const { access, state } = await accountingPageAccess();
  if (state !== "ok") redirect("/app/comptabilite");
  const years = await listFiscalYears(access);
  const today = todayInParis();
  const companyId = access.company.id;
  const canClose = access.permissions.has("accounting:close");
  const canExport = access.permissions.has("exports:run");
  const api = `/api/v1/companies/${companyId}/accounting`;

  return (
    <>
      <PageHeader title="Exercices et exports" description="Verrouillage des périodes, clôture des exercices, fichier des écritures comptables (FEC) et exports." actions={canClose ? <NextYearButton companyId={companyId} /> : undefined} />
      <AccountingTabs current="exercices" />
      <Alert className="mb-6">
        <InfoIcon />
        <AlertTitle>Fichier des écritures comptables</AlertTitle>
        <AlertDescription>
          Le FEC reprend les seules écritures validées, au format prévu par l'article A47 A-1 du livre des procédures fiscales. Pour un exercice non clôturé, il est provisoire. Avant toute remise à l'administration, contrôlez-le avec l'outil « Test Compta Demat » de la DGFiP et faites-le valider par votre expert-comptable.
          {!access.company.siren ? " Renseignez d'abord le SIREN de l'entreprise : il compose le nom du fichier." : ""}
        </AlertDescription>
      </Alert>
      <div className="grid gap-4">
        {years.map((year) => {
          const closed = year.status === "CLOSED";
          const ended = year.endDate < today;
          const lockMin = year.lockedThrough ? addDays(year.lockedThrough, 1) : year.startDate;
          const lockDefault = [today > year.endDate ? year.endDate : addDays(today, -1), lockMin].sort().at(-1)!;
          const query = `fiscalYearId=${year.id}`;
          return (
            <Card key={year.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3">
                  {year.label}
                  {closed ? <Badge variant="secondary">Clôturé</Badge> : ended ? <Badge variant="warning">Terminé, à clôturer</Badge> : <Badge variant="success">En cours</Badge>}
                </CardTitle>
                <CardDescription>
                  Du {formatDate(year.startDate)} au {formatDate(year.endDate)} · {year.entryCount} écriture{year.entryCount > 1 ? "s" : ""}{year.draftCount > 0 ? `, dont ${year.draftCount} au brouillard` : ""}
                  {closed && year.closedAt ? ` · clôturé le ${formatDateTime(year.closedAt)}` : year.lockedThrough ? ` · verrouillé jusqu'au ${formatDate(year.lockedThrough)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  {canExport ? (
                    <>
                      <Button asChild variant="outline" size="sm"><a href={`${api}/fec?${query}`} download><DownloadIcon /> FEC{closed ? "" : " provisoire"}</a></Button>
                      <Button asChild variant="ghost" size="sm"><a href={`${api}/reports/balance?${query}&format=csv&drafts=exclude`} download>Balance (CSV)</a></Button>
                      <Button asChild variant="ghost" size="sm"><a href={`${api}/reports/ledger?${query}&format=csv&drafts=exclude`} download>Grand livre (CSV)</a></Button>
                      <Button asChild variant="ghost" size="sm"><a href={`${api}/reports/journal?${query}&drafts=exclude`} download>Journaux (CSV)</a></Button>
                    </>
                  ) : null}
                </div>
                {canClose && !closed ? (
                  <div className="flex flex-wrap items-end gap-3">
                    {lockMin <= year.endDate ? <LockPeriodForm companyId={companyId} fiscalYearId={year.id} min={lockMin} max={year.endDate} defaultDate={lockDefault} /> : null}
                    {ended ? <CloseYearButton companyId={companyId} fiscalYearId={year.id} label={year.label} /> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
