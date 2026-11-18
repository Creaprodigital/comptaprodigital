import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { AppError } from "@/server/http/errors";
import { getAsset, getAssetHistory } from "@/server/modules/accounting/assets";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HistoryList } from "@/components/app/billing/shared";
import { AssetActions } from "@/components/app/accounting/assets-view";

export const metadata: Metadata = { title: "Immobilisation" };
export const instant = false;

type Props = { params: Promise<{ assetId: string }> };

export default async function AssetPage({ params }: Props) {
  const [{ access, state }, { assetId }] = await Promise.all([accountingPageAccess(), params]);
  if (state !== "ok") redirect("/app/comptabilite");
  const asset = await getAsset(access, assetId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const history = await getAssetHistory(access, assetId);
  const money = (v: string) => formatCurrency(v, { currency: access.company.currency });
  const recorded = new Map(asset.recorded.map((r) => [r.fiscalYearLabel, r]));
  const details: Array<[string, string]> = [
    ["Compte", `${asset.assetAccountNumber} (amortissements ${asset.depreciationAccountNumber})`],
    ["Acquisition", formatDate(asset.acquisitionDate, "long")],
    ["Mise en service", formatDate(asset.serviceDate, "long")],
    ["Mode", `${asset.method === "LINEAR" ? "Linéaire" : "Dégressif"} sur ${asset.durationMonths} mois`],
    ["Valeur d'origine", money(asset.cost)],
    ["Amortissements comptabilisés", money(asset.cumulated)],
    ["Valeur nette comptable", money(asset.netBookValue)],
    ...(asset.disposedAt ? ([["Sortie", `${formatDate(asset.disposedAt, "long")}${asset.disposalPrice && Number(asset.disposalPrice) > 0 ? ` — cession pour ${money(asset.disposalPrice)}` : " — mise au rebut"}`]] as Array<[string, string]>) : []),
  ];
  return (
    <>
      <Link href="/app/comptabilite/immobilisations" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Immobilisations
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-[28px]">{asset.label}</h1>
        {access.permissions.has("accounting:write") ? <AssetActions companyId={access.company.id} asset={asset} today={todayInParis()} /> : null}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Plan d'amortissement</CardTitle></CardHeader>
          <CardContent className="px-2 pb-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent"><TableHead>Exercice</TableHead><TableHead className="text-right">Dotation</TableHead><TableHead className="hidden sm:table-cell text-right">Cumul</TableHead><TableHead className="text-right">Valeur nette</TableHead><TableHead className="hidden md:table-cell">Comptabilisée</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {asset.plan.map((row) => {
                  const label = `Exercice ${row.start.slice(0, 4)}${row.start.slice(0, 4) === row.end.slice(0, 4) ? "" : `-${row.end.slice(0, 4)}`}`;
                  const done = recorded.get(label);
                  return (
                    <TableRow key={row.start}>
                      <TableCell className="tabular">{formatDate(row.start)} – {formatDate(row.end)}</TableCell>
                      <TableCell className="tabular text-right">{money(row.amount)}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{money(row.cumulative)}</TableCell>
                      <TableCell className="tabular text-right">{money(row.netBookValue)}</TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{done ? `Oui (${money(done.amount)})` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid gap-6">
          <Card>
            <CardContent className="py-5">
              <dl className="grid gap-3 text-sm">
                {details.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent><HistoryList entries={history} /></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
