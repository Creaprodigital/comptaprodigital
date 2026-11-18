import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, DownloadIcon } from "lucide-react";
import { listAssets, pendingDepreciations } from "@/server/modules/accounting/assets";
import { listFiscalYears } from "@/server/modules/accounting/closing";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/billing/shared";
import { AccountingTabs } from "@/components/app/accounting/shared";
import { NewAssetButton, PostDepreciationButton } from "@/components/app/accounting/assets-view";

export const metadata: Metadata = { title: "Immobilisations" };

const STATUS = { ACTIVE: ["En cours", "accent"], FULLY_DEPRECIATED: ["Totalement amorti", "secondary"], DISPOSED: ["Sorti", "outline"] } as const;

export default async function AssetsPage() {
  const { access, state } = await accountingPageAccess();
  if (state !== "ok") redirect("/app/comptabilite");
  const today = todayInParis();
  const [assets, years] = await Promise.all([listAssets(access), listFiscalYears(access)]);
  const openYears = years.filter((y) => y.status === "OPEN" && y.startDate <= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pending = await Promise.all(openYears.map(async (y) => ({ year: y, items: await pendingDepreciations(access, y.id) })));
  const canWrite = access.permissions.has("accounting:write");
  const currency = access.company.currency;

  return (
    <>
      <PageHeader
        title="Immobilisations"
        description="Registre des biens durables de l'entreprise et de leurs amortissements."
        actions={
          <>
            <Button asChild variant="outline"><a href={`/api/v1/companies/${access.company.id}/accounting/assets?format=csv`} download><DownloadIcon /> Exporter (CSV)</a></Button>
            {canWrite ? <NewAssetButton companyId={access.company.id} today={today} /> : null}
          </>
        }
      />
      <AccountingTabs current="immobilisations" />
      {pending.filter((p) => p.items.length > 0).map((p) => (
        <Alert key={p.year.id} variant="warning" className="mb-4">
          <AlertTriangleIcon />
          <AlertTitle>Dotations à calculer — {p.year.label}</AlertTitle>
          <AlertDescription>
            <p>{p.items.length} bien{p.items.length > 1 ? "s" : ""} : {p.items.map((i) => `${i.label} (${formatCurrency(i.planned, { currency })})`).join(", ")}. Le calcul peut être relancé tant que l'exercice est ouvert.</p>
            {canWrite ? <div className="mt-3"><PostDepreciationButton companyId={access.company.id} fiscalYearId={p.year.id} label={p.year.label} /></div> : null}
          </AlertDescription>
        </Alert>
      ))}
      {assets.length === 0 ? (
        <EmptyState title="Aucune immobilisation" description="Inscrivez au registre les biens destinés à durer : matériel informatique, véhicule, mobilier, logiciels…" />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Bien</TableHead><TableHead className="hidden md:table-cell">Acquisition</TableHead><TableHead className="hidden sm:table-cell text-right">Valeur d'origine</TableHead><TableHead className="hidden lg:table-cell text-right">Amortissements</TableHead><TableHead className="text-right">Valeur nette</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/app/comptabilite/immobilisations/${a.id}`} className="font-medium hover:text-primary hover:underline">{a.label}</Link>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{a.assetAccountNumber} · {a.method === "LINEAR" ? "linéaire" : "dégressif"} sur {a.durationMonths} mois <Badge variant={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge></p>
                    </TableCell>
                    <TableCell className="tabular hidden text-muted-foreground md:table-cell">{formatDate(a.acquisitionDate)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{formatCurrency(a.cost, { currency })}</TableCell>
                    <TableCell className="tabular hidden text-right lg:table-cell">{formatCurrency(a.cumulated, { currency })}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatCurrency(a.netBookValue, { currency })}</TableCell>
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
