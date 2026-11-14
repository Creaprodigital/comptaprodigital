import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { getInvoiceDetail, getInvoiceHistory, serializeInvoice } from "@/server/modules/invoicing/invoices";
import { defaultInvoiceMessage } from "@/server/modules/invoicing/sending";
import { listVatRates } from "@/server/modules/products/service";
import { todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { INVOICE_TYPE_LABELS, OPERATION_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/invoicing";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentLines } from "@/components/app/billing/document-summary";
import { DeletePaymentButton, InvoiceActions } from "@/components/app/billing/invoice-actions";
import { HistoryList, InvoiceStatusBadge } from "@/components/app/billing/shared";

export const metadata: Metadata = { title: "Facture" };

type Props = { params: Promise<{ invoiceId: string }> };

export default async function InvoicePage({ params }: Props) {
  const [{ access }, { invoiceId }] = await Promise.all([requireCompany("invoices:read"), params]);
  const detail = await getInvoiceDetail(access, invoiceId);
  const [history, vatRates] = await Promise.all([getInvoiceHistory(access, invoiceId), listVatRates(access)]);
  const invoice = serializeInvoice(detail);
  const draft = invoice.status === "DRAFT";
  const creditNote = invoice.type === "CREDIT_NOTE";
  const money = (value: string) => formatCurrency(value, { currency: access.company.currency });
  const defaults = draft ? { subject: "", message: "" } : defaultInvoiceMessage(access.company.name, detail);
  const settled = !draft && !creditNote;

  return (
    <>
      <Link href="/app/factures" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Toutes les factures
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-[28px]">
              {INVOICE_TYPE_LABELS[invoice.type]} {invoice.number ?? "(brouillon)"}
            </h1>
            <InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} type={invoice.type} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoice.customerName}
            {invoice.subject ? ` · ${invoice.subject}` : ""}
          </p>
        </div>
        <InvoiceActions
          companyId={access.company.id}
          invoice={invoice}
          permissions={{
            canWrite: access.permissions.has("invoices:write"),
            canIssue: access.permissions.has("invoices:issue"),
            canPay: access.permissions.has("payments:write"),
          }}
          sendDefaults={{ to: invoice.customerEmail ?? "", ...defaults }}
          vatRates={vatRates}
          today={todayInParis()}
        />
      </div>

      {draft ? (
        <Alert className="mb-6">
          <InfoIcon />
          <AlertDescription className="text-foreground">
            Ce document est un brouillon : il n'a pas de numéro et peut encore être modifié ou supprimé. {creditNote ? "L'avoir" : "La facture"} devient définiti
            {creditNote ? "f" : "ve"} à l'émission.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Détail</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentLines
                items={invoice.items}
                totals={settled ? { ...invoice, remaining: invoice.remaining } : invoice}
                currency={access.company.currency}
              />
              {invoice.notes ? <p className="mt-6 rounded-xl bg-muted/50 p-4 text-sm whitespace-pre-line">{invoice.notes}</p> : null}
            </CardContent>
          </Card>

          {settled ? (
            <Card>
              <CardHeader>
                <CardTitle>Règlements</CardTitle>
              </CardHeader>
              <CardContent>
                {invoice.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun règlement enregistré.</p>
                ) : (
                  <ul className="divide-y">
                    {invoice.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center gap-4 py-3 text-sm first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {formatDate(payment.paidAt)} · {PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS]}
                          </p>
                          {payment.reference ? <p className="truncate text-xs text-muted-foreground">{payment.reference}</p> : null}
                        </div>
                        <p className="tabular font-semibold text-success-foreground">{money(payment.amount)}</p>
                        {access.permissions.has("payments:write") && !payment.linkedToBank ? (
                          <DeletePaymentButton companyId={access.company.id} invoiceId={invoice.id} paymentId={payment.id} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Client</dt>
                  <dd className="text-right font-medium">{invoice.customerName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Date d'émission</dt>
                  <dd className="font-medium">{invoice.issueDate ? formatDate(invoice.issueDate) : "—"}</dd>
                </div>
                {!creditNote ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Échéance</dt>
                    <dd className="font-medium">{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</dd>
                  </div>
                ) : null}
                {invoice.serviceDate ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Prestation</dt>
                    <dd className="font-medium">{formatDate(invoice.serviceDate)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Nature</dt>
                  <dd className="text-right font-medium">{OPERATION_CATEGORY_LABELS[invoice.operationCategory]}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">TVA exigible</dt>
                  <dd className="text-right font-medium">{invoice.vatExigibility === "DEBITS" ? "À la facturation" : "À l'encaissement"}</dd>
                </div>
                {invoice.paymentTerms ? (
                  <div>
                    <dt className="text-muted-foreground">Conditions de paiement</dt>
                    <dd className="mt-1 whitespace-pre-line">{invoice.paymentTerms}</dd>
                  </div>
                ) : null}
                {invoice.quote ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Devis d'origine</dt>
                    <dd><Link href={`/app/devis/${invoice.quote.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{invoice.quote.number}</Link></dd>
                  </div>
                ) : null}
                {invoice.originalInvoice ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Facture d'origine</dt>
                    <dd><Link href={`/app/factures/${invoice.originalInvoice.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{invoice.originalInvoice.number}</Link></dd>
                  </div>
                ) : null}
                {invoice.creditNotes.length > 0 ? (
                  <div>
                    <dt className="text-muted-foreground">Avoirs</dt>
                    <dd className="mt-1 grid gap-1">
                      {invoice.creditNotes.map((note) => (
                        <Link key={note.id} href={`/app/factures/${note.id}`} className="flex justify-between gap-4 font-medium text-primary underline-offset-4 hover:underline">
                          <span>{note.number ?? "Brouillon"}</span>
                          <span className="tabular">− {money(note.totalInclTax)}</span>
                        </Link>
                      ))}
                    </dd>
                  </div>
                ) : null}
                {invoice.reminderCount > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Relances envoyées</dt>
                    <dd className="font-medium">{invoice.reminderCount}</dd>
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
