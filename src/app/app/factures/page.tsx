import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, PlusIcon, RepeatIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { listInvoices } from "@/server/modules/invoicing/invoices";
import { formatCurrency, formatDate } from "@/lib/format";
import { INVOICE_TYPE_LABELS } from "@/lib/invoicing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, FilterTabs, InvoiceStatusBadge, Pagination, SearchForm } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Factures" };

type Props = { searchParams: Promise<{ q?: string; page?: string; status?: string }> };

const FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "draft", label: "Brouillons" },
  { value: "unpaid", label: "À encaisser" },
  { value: "overdue", label: "En retard" },
  { value: "paid", label: "Payées" },
  { value: "credit_note", label: "Avoirs" },
];

export default async function InvoicesPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("invoices:read"), searchParams]);
  const page = Math.max(1, Number(params.page) || 1);
  const result = await listInvoices(access, { q: params.q?.slice(0, 100), filter: params.status, page });
  const canWrite = access.permissions.has("invoices:write");
  const companyId = access.company.id;
  const money = (value: string) => formatCurrency(value, { currency: access.company.currency });
  const newButton = canWrite ? (
    <Button asChild>
      <Link href="/app/factures/nouvelle"><PlusIcon /> Nouvelle facture</Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Factures"
        description="Factures, factures d'acompte et avoirs de l'entreprise."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/factures/recurrentes"><RepeatIcon /> Récurrentes</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/v1/companies/${companyId}/invoices/export`} download><DownloadIcon /> Exporter (CSV)</a>
            </Button>
            {newButton}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs basePath="/app/factures" current={result.filter} options={FILTERS} query={params.q} />
        <SearchForm action="/app/factures" query={params.q} placeholder="Numéro, client ou objet" hidden={{ status: result.filter === "all" ? undefined : result.filter }} />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          title={params.q || result.filter !== "all" ? "Aucune facture ne correspond" : "Aucune facture pour l'instant"}
          description={params.q || result.filter !== "all" ? "Modifiez votre recherche ou vos filtres." : "Créez votre première facture : elle reste en brouillon tant que vous ne l'émettez pas."}
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
                  <TableHead className="hidden md:table-cell">Émise le</TableHead>
                  <TableHead className="hidden md:table-cell">Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Total TTC</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Reste dû</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link href={`/app/factures/${invoice.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {invoice.number ?? "Brouillon"}
                      </Link>
                      {invoice.type !== "INVOICE" ? <p className="text-xs text-muted-foreground">{INVOICE_TYPE_LABELS[invoice.type]}</p> : null}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-56 truncate">{invoice.customerName}</p>
                      {invoice.subject ? <p className="max-w-56 truncate text-xs text-muted-foreground">{invoice.subject}</p> : null}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{invoice.issueDate && invoice.number ? formatDate(invoice.issueDate) : "—"}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</TableCell>
                    <TableCell><InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} type={invoice.type} /></TableCell>
                    <TableCell className="tabular text-right font-medium whitespace-nowrap">
                      {invoice.type === "CREDIT_NOTE" ? "− " : ""}
                      {money(invoice.totalInclTax)}
                    </TableCell>
                    <TableCell className="tabular hidden text-right whitespace-nowrap lg:table-cell">{Number(invoice.remaining) > 0 ? money(invoice.remaining) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/factures" page={result.page} pageSize={result.pageSize} total={result.total} params={{ q: params.q, status: result.filter === "all" ? undefined : result.filter }} />
    </>
  );
}
