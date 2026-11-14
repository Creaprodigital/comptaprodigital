import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { listQuotes } from "@/server/modules/invoicing/quotes";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, FilterTabs, Pagination, QuoteStatusBadge, SearchForm } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Devis" };

type Props = { searchParams: Promise<{ q?: string; page?: string; status?: string }> };

const FILTERS = [
  { value: "all", label: "Tous" },
  { value: "DRAFT", label: "Brouillons" },
  { value: "SENT", label: "Envoyés" },
  { value: "ACCEPTED", label: "Acceptés" },
  { value: "INVOICED", label: "Facturés" },
  { value: "REJECTED", label: "Refusés" },
  { value: "EXPIRED", label: "Expirés" },
];

export default async function QuotesPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("quotes:read"), searchParams]);
  const page = Math.max(1, Number(params.page) || 1);
  const result = await listQuotes(access, { q: params.q?.slice(0, 100), filter: params.status, page });
  const canWrite = access.permissions.has("quotes:write");
  const money = (value: string) => formatCurrency(value, { currency: access.company.currency });
  const newButton = canWrite ? (
    <Button asChild>
      <Link href="/app/devis/nouveau"><PlusIcon /> Nouveau devis</Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Devis"
        description="Vos propositions commerciales, de l'envoi à la facturation."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/v1/companies/${access.company.id}/quotes/export`} download><DownloadIcon /> Exporter (CSV)</a>
            </Button>
            {newButton}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs basePath="/app/devis" current={result.filter} options={FILTERS} query={params.q} />
        <SearchForm action="/app/devis" query={params.q} placeholder="Numéro, client ou objet" hidden={{ status: result.filter === "all" ? undefined : result.filter }} />
      </div>
      {result.items.length === 0 ? (
        <EmptyState
          title={params.q || result.filter !== "all" ? "Aucun devis ne correspond" : "Aucun devis pour l'instant"}
          description={params.q || result.filter !== "all" ? "Modifiez votre recherche ou vos filtres." : "Établissez un devis, envoyez-le, puis transformez-le en facture une fois accepté."}
          action={!params.q && result.filter === "all" ? newButton : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Numéro</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="hidden md:table-cell">Valable jusqu'au</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Total TTC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((quote) => (
                  <TableRow key={quote.id}>
                    <TableCell>
                      <Link href={`/app/devis/${quote.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{quote.number}</Link>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-56 truncate">{quote.customerName}</p>
                      {quote.subject ? <p className="max-w-56 truncate text-xs text-muted-foreground">{quote.subject}</p> : null}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{formatDate(quote.issueDate)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{quote.validUntil ? formatDate(quote.validUntil) : "—"}</TableCell>
                    <TableCell><QuoteStatusBadge status={quote.status} /></TableCell>
                    <TableCell className="tabular text-right font-medium whitespace-nowrap">{money(quote.totalInclTax)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/devis" page={result.page} pageSize={result.pageSize} total={result.total} params={{ q: params.q, status: result.filter === "all" ? undefined : result.filter }} />
    </>
  );
}
