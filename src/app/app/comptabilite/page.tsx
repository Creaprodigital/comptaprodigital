import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, DownloadIcon } from "lucide-react";
import { accountingOverview } from "@/server/modules/accounting/chart";
import { purchaseRegister, receiptsBook } from "@/server/modules/accounting/cash-book";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { ModuleLocked } from "@/components/app/bank/shared";
import { ACCOUNTING_SECTIONS, AccountingTabs } from "@/components/app/accounting/shared";
import { ResyncButton, ValidateThroughForm } from "@/components/app/accounting/actions";

export const metadata: Metadata = { title: "Comptabilité" };

type Props = { searchParams: Promise<{ annee?: string; registre?: string }> };

const DESCRIPTIONS: Record<string, string> = {
  ecritures: "Brouillard, écritures validées, saisie d'opérations diverses.",
  "grand-livre": "Le détail de chaque compte et son solde progressif.",
  balance: "Totaux et soldes de tous les comptes, par classe.",
  tiers: "Comptes clients et fournisseurs, lettrage.",
  rapprochement: "Concordance entre la banque et le compte 512.",
  immobilisations: "Registre des biens et plans d'amortissement.",
  exercices: "Verrouillage, clôture, FEC et exports.",
  "plan-comptable": "Comptes de référence et comptes de l'entreprise.",
};

export default async function AccountingPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  const companyId = access.company.id;
  const currency = access.company.currency;

  if (state === "cash-book") {
    const year = Number(params.annee) || Number(todayInParis().slice(0, 4));
    const purchasesView = params.registre === "achats";
    const book = purchasesView ? null : await receiptsBook(access, year);
    const register = purchasesView ? await purchaseRegister(access, year) : null;
    const years = Array.from({ length: 5 }, (_, i) => Number(todayInParis().slice(0, 4)) - i);
    const csv = `/api/v1/companies/${companyId}/accounting/cash-book?year=${year}&book=${purchasesView ? "purchases" : "receipts"}&format=csv`;
    return (
      <>
        <PageHeader
          title={purchasesView ? "Registre des achats" : "Livre des recettes"}
          description="Micro-entreprise : vos encaissements, dans l'ordre chronologique, avec leur origine et leur mode de règlement."
          actions={
            <Button asChild variant="outline">
              <a href={csv} download><DownloadIcon /> Exporter (CSV)</a>
            </Button>
          }
        />
        <form method="get" action="/app/comptabilite" className="mb-4 flex flex-wrap items-end gap-2">
          <NativeSelect name="annee" defaultValue={String(year)} className="h-9 w-32" aria-label="Année">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </NativeSelect>
          <NativeSelect name="registre" defaultValue={purchasesView ? "achats" : "recettes"} className="h-9 w-56" aria-label="Registre">
            <option value="recettes">Livre des recettes</option>
            <option value="achats">Registre des achats</option>
          </NativeSelect>
          <Button type="submit" variant="outline" size="sm" className="h-9">Afficher</Button>
        </form>
        <Card>
          <CardHeader>
            <CardTitle>{year} — total {formatCurrency((book?.total ?? register?.total)!, { currency })}</CardTitle>
            <CardDescription>
              {purchasesView ? "Le registre récapitule vos achats de l'année (activités de vente de marchandises)." : "Le chiffre d'affaires d'une micro-entreprise correspond aux sommes encaissées. Surveillez le seuil de votre régime auprès de l'URSSAF ou de votre conseil."}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {(book?.rows ?? register?.rows ?? []).length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Aucune opération sur cette année.</p>
            ) : book ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead><TableHead>Pièce</TableHead><TableHead>Client et nature</TableHead><TableHead className="hidden md:table-cell">Règlement</TableHead><TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {book.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</TableCell>
                      <TableCell>{r.href ? <Link href={r.href} className="hover:text-primary hover:underline">{r.reference || "—"}</Link> : r.reference || "—"}</TableCell>
                      <TableCell><p className="font-medium">{r.customer || "—"}</p><p className="text-xs text-muted-foreground">{r.label}</p></TableCell>
                      <TableCell className="hidden md:table-cell">{r.method}</TableCell>
                      <TableCell className="tabular text-right font-medium">{formatCurrency(r.amount, { currency })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead><TableHead>Fournisseur et objet</TableHead><TableHead className="hidden md:table-cell">Règlement</TableHead><TableHead className="text-right">Montant TTC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {register!.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</TableCell>
                      <TableCell><Link href={r.href} className="font-medium hover:text-primary hover:underline">{r.supplier || "—"}{r.reference ? ` — ${r.reference}` : ""}</Link><p className="text-xs text-muted-foreground">{r.label}</p></TableCell>
                      <TableCell className="hidden md:table-cell">{r.paidAt ? `Payée le ${formatDate(r.paidAt)}` : r.method}</TableCell>
                      <TableCell className="tabular text-right font-medium">{formatCurrency(r.amount, { currency })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  if (state === "locked") {
    return (
      <>
        <PageHeader title="Comptabilité" description="Journaux, grand livre, balance, immobilisations, clôture et FEC." />
        <ModuleLocked title="La comptabilité fait partie de la formule Pro" description="Tenez votre comptabilité en partie double, alimentée automatiquement par vos factures, achats et opérations bancaires, en passant à la formule Pro." />
      </>
    );
  }

  const overview = await accountingOverview(access);
  const canWrite = access.permissions.has("accounting:write");
  const suspense = Number(overview.suspenseBalance) !== 0;
  return (
    <>
      <PageHeader title="Comptabilité" description="Comptabilité en partie double, alimentée par vos factures, vos achats et vos opérations bancaires." actions={canWrite ? <ResyncButton companyId={companyId} /> : undefined} />
      <AccountingTabs current="apercu" />
      <Alert className="mb-6">
        <AlertTriangleIcon />
        <AlertTitle>Écritures proposées, validées par vous</AlertTitle>
        <AlertDescription>
          Les écritures générées à partir de vos pièces restent au brouillard jusqu'à leur validation. Une écriture validée ne se modifie plus : toute correction passe par une contre-passation, conservée dans l'historique. Les règles de comptabilisation et les états produits sont à faire vérifier par un professionnel de la comptabilité.
        </AlertDescription>
      </Alert>
      {overview.syncErrors > 0 ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>Comptabilisation automatique incomplète</AlertTitle>
          <AlertDescription>Certaines pièces n'ont pas pu être comptabilisées récemment. Lancez « Recalculer les écritures automatiques » ; si le problème persiste, contactez le support.</AlertDescription>
        </Alert>
      ) : null}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Brouillard</CardTitle>
            <CardDescription>{overview.draftCount === 0 ? "Toutes les écritures sont validées." : `${overview.draftCount} écriture${overview.draftCount > 1 ? "s" : ""} à vérifier et valider${overview.oldestDraft ? `, la plus ancienne du ${formatDate(overview.oldestDraft)}` : ""}.`}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button asChild variant="outline" size="sm" className="w-fit"><Link href="/app/comptabilite/ecritures?statut=DRAFT">Voir le brouillard <ArrowRightIcon /></Link></Button>
            {canWrite && overview.draftCount > 0 ? <ValidateThroughForm companyId={companyId} defaultDate={todayInParis()} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Compte d'attente</CardTitle>
            <CardDescription>{suspense ? "Des opérations restent à classer (opérations bancaires sans catégorie, soldes d'ouverture…)." : "Aucune opération en attente de classement."}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className={suspense ? "tabular font-display text-2xl font-bold text-warning-foreground" : "tabular font-display text-2xl font-bold"}>{formatCurrency(overview.suspenseBalance, { currency })}</p>
            {suspense ? <Button asChild variant="link" className="h-auto px-0"><Link href="/app/comptabilite/grand-livre?compte=471">Voir le compte 471000</Link></Button> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exercice</CardTitle>
            <CardDescription>
              {overview.fiscalYear ? `${overview.fiscalYear.label} : du ${formatDate(overview.fiscalYear.startDate)} au ${formatDate(overview.fiscalYear.endDate)}.` : "Aucun exercice en cours."}
              {overview.fiscalYear?.lockedThrough ? ` Verrouillé jusqu'au ${formatDate(overview.fiscalYear.lockedThrough)}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.yearsToClose.length > 0 ? (
              <p className="text-sm text-warning-foreground">
                {overview.yearsToClose.map((y) => y.label).join(", ")} : terminé, à clôturer.{" "}
                <Link href="/app/comptabilite/exercices" className="font-medium underline-offset-4 hover:underline">Préparer la clôture</Link>
              </p>
            ) : (
              <Button asChild variant="outline" size="sm"><Link href="/app/comptabilite/exercices">Exercices et exports</Link></Button>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACCOUNTING_SECTIONS.filter((s) => s.key !== "apercu").map((section) => (
          <Link key={section.key} href={section.href} className="rounded-2xl border bg-card px-5 py-4 shadow-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring">
            <p className="font-semibold">{section.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{DESCRIPTIONS[section.key]}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
