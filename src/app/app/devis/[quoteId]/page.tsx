import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { getQuoteDetail, getQuoteHistory, serializeQuote } from "@/server/modules/invoicing/quotes";
import { defaultQuoteMessage } from "@/server/modules/invoicing/sending";
import { formatCurrency, formatDate } from "@/lib/format";
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS } from "@/lib/invoicing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentLines } from "@/components/app/billing/document-summary";
import { QuoteActions } from "@/components/app/billing/quote-actions";
import { HistoryList, QuoteStatusBadge } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Devis" };

type Props = { params: Promise<{ quoteId: string }> };

export default async function QuotePage({ params }: Props) {
  const [{ access }, { quoteId }] = await Promise.all([requireCompany("quotes:read"), params]);
  const detail = await getQuoteDetail(access, quoteId);
  const [history, depositsAvailable] = await Promise.all([getQuoteHistory(access, quoteId), companyHasModule(access.company.id, "invoicing-advanced")]);
  const quote = serializeQuote(detail);
  const money = (value: string) => formatCurrency(value, { currency: access.company.currency });

  return (
    <>
      <Link href="/app/devis" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Tous les devis
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-[28px]">Devis {quote.number}</h1>
            <QuoteStatusBadge status={quote.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {quote.customerName}
            {quote.subject ? ` · ${quote.subject}` : ""}
          </p>
        </div>
        <QuoteActions
          companyId={access.company.id}
          quote={quote}
          canWrite={access.permissions.has("quotes:write")}
          canInvoice={access.permissions.has("invoices:write")}
          depositsAvailable={depositsAvailable}
          sendDefaults={{ to: quote.customerEmail ?? "", ...defaultQuoteMessage(access.company.name, detail) }}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Détail</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentLines items={quote.items} totals={quote} currency={access.company.currency} />
            {quote.notes ? <p className="mt-6 rounded-xl bg-muted/50 p-4 text-sm whitespace-pre-line">{quote.notes}</p> : null}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Client</dt><dd className="text-right font-medium">{quote.customerName}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Date du devis</dt><dd className="font-medium">{formatDate(quote.issueDate)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Valable jusqu'au</dt><dd className="font-medium">{quote.validUntil ? formatDate(quote.validUntil) : "—"}</dd></div>
                {quote.terms ? (
                  <div>
                    <dt className="text-muted-foreground">Conditions</dt>
                    <dd className="mt-1 whitespace-pre-line">{quote.terms}</dd>
                  </div>
                ) : null}
                {quote.invoices.length > 0 ? (
                  <div>
                    <dt className="text-muted-foreground">Factures liées</dt>
                    <dd className="mt-1 grid gap-1.5">
                      {quote.invoices.map((invoice) => (
                        <Link key={invoice.id} href={`/app/factures/${invoice.id}`} className="flex justify-between gap-4 text-primary underline-offset-4 hover:underline">
                          <span className="font-medium">
                            {invoice.number ?? "Brouillon"}
                            <span className="font-normal text-muted-foreground"> · {INVOICE_TYPE_LABELS[invoice.type as keyof typeof INVOICE_TYPE_LABELS]} · {INVOICE_STATUS_LABELS[invoice.status as keyof typeof INVOICE_STATUS_LABELS].toLowerCase()}</span>
                          </span>
                          <span className="tabular">{money(invoice.totalInclTax)}</span>
                        </Link>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryList entries={history} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
