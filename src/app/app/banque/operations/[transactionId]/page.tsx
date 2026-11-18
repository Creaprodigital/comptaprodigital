import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, CopyIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { companyHasModule } from "@/server/modules/plans/service";
import { listCategories } from "@/server/modules/bank/categories";
import { suggestReconciliation } from "@/server/modules/bank/reconciliation";
import { suggestPurchases } from "@/server/modules/purchases/service";
import { getTransactionDetail } from "@/server/modules/bank/transactions";
import { requiresReceipt } from "@/lib/bank";
import { todayInParis } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Amount, TransactionStatusBadge } from "@/components/app/bank/shared";
import { DeleteTransactionButton, DuplicateActions, ReconcilePanel, TransactionForm } from "@/components/app/bank/transaction-detail";
import { HistoryList } from "@/components/app/billing/shared";
import { AttachedDocuments } from "@/components/app/documents/documents-view";
import { PurchaseLinkPanel } from "@/components/app/purchases/purchase-link-panel";

export const metadata: Metadata = { title: "Opération bancaire" };
export const instant = false;

type Props = { params: Promise<{ transactionId: string }> };

export default async function TransactionPage({ params }: Props) {
  const [{ access }, { transactionId }] = await Promise.all([requireCompany("bank:read"), params]);
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const detail = await getTransactionDetail(access, transactionId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const { transaction } = detail;
  const companyId = access.company.id;
  const canWrite = access.permissions.has("bank:write");
  const inflow = !transaction.amount.startsWith("-");
  const canSeePurchases = access.permissions.has("purchases:read");
  const [categories, suggestions, documentsAvailable, purchaseSuggestions] = await Promise.all([
    listCategories(companyId),
    inflow ? suggestReconciliation(access, transaction) : null,
    companyHasModule(companyId, "documents"),
    !inflow && canSeePurchases && !transaction.purchase ? suggestPurchases(access, transaction) : [],
  ]);
  const canReadDocuments = documentsAvailable && access.permissions.has("documents:read");
  const history = [
    ...(detail.source ? [{ id: "source", action: "bank.import", at: detail.source.importedAt, actor: null, detail: `Importée du relevé « ${detail.source.fileName} »` }] : []),
    ...detail.history,
  ];

  return (
    <>
      <Link href="/app/banque" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Toutes les opérations
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words sm:text-[28px]">{transaction.label}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{formatDate(transaction.date, "long")}</span>
            <span>{transaction.account.name}</span>
            <span>{transaction.manual ? "Saisie manuelle" : detail.source ? `Relevé du ${formatDateTime(detail.source.importedAt)}` : "Opération importée"}</span>
            <TransactionStatusBadge status={transaction.status} />
          </p>
        </div>
        <Amount value={transaction.amount} currency={transaction.currency} className="font-display text-3xl" />
      </div>

      {transaction.isDuplicateSuspect ? (
        <Alert variant="warning" className="mb-6">
          <CopyIcon />
          <AlertTitle>Doublon possible</AlertTitle>
          <AlertDescription>
            <p>Une autre opération de ce compte porte la même date et le même montant :</p>
            <ul className="mt-1 list-disc pl-4">
              {detail.similar.map((other) => (
                <li key={other.id}>
                  <Link href={`/app/banque/operations/${other.id}`} className="font-medium underline-offset-4 hover:underline">
                    {other.label}
                  </Link>
                </li>
              ))}
            </ul>
            {canWrite ? <DuplicateActions companyId={companyId} transactionId={transaction.id} /> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Catégorisation</CardTitle>
              <CardDescription>{transaction.manual ? "Opération saisie à la main : tout reste modifiable." : "La date et le montant proviennent de la banque et ne sont pas modifiables."}</CardDescription>
            </CardHeader>
            <CardContent>
              <TransactionForm key={`${transaction.id}:${history.length}`} companyId={companyId} transaction={transaction} categories={categories} canWrite={canWrite} today={todayInParis()} />
            </CardContent>
          </Card>

          {!inflow && canSeePurchases ? (
            <Card>
              <CardHeader>
                <CardTitle>Facture d'achat</CardTitle>
                <CardDescription>Rattachez ce décaissement à la facture du fournisseur qu'il règle : elle passe en « payée » et sa TVA devient déductible si c'est un service.</CardDescription>
              </CardHeader>
              <CardContent>
                <PurchaseLinkPanel companyId={companyId} transactionId={transaction.id} linked={transaction.purchase} suggestions={purchaseSuggestions} canWrite={canWrite && access.permissions.has("purchases:write")} currency={transaction.currency} />
              </CardContent>
            </Card>
          ) : null}

          {inflow && suggestions ? (
            <Card>
              <CardHeader>
                <CardTitle>Rapprochement avec vos factures</CardTitle>
                <CardDescription>Affectez cet encaissement aux factures qu'il règle : elles passent en « payée » et l'opération en « rapprochée ».</CardDescription>
              </CardHeader>
              <CardContent>
                <ReconcilePanel key={`${transaction.allocated}:${suggestions.invoices.length}`} companyId={companyId} transaction={transaction} payments={detail.payments} suggestions={suggestions} canWrite={canWrite} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Justificatifs</CardTitle>
              {requiresReceipt(transaction) ? (
                <CardDescription className="flex items-center gap-1.5 text-warning-foreground">
                  <AlertTriangleIcon className="size-4" aria-hidden="true" /> Cette dépense n'a pas encore de justificatif.
                </CardDescription>
              ) : (
                <CardDescription>Facture, reçu ou toute pièce appuyant l'opération.</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {canReadDocuments ? (
                <AttachedDocuments
                  companyId={companyId}
                  link={{ entityType: "BANK_TRANSACTION", entityId: transaction.id }}
                  documents={detail.documents}
                  canWrite={canWrite && access.permissions.has("documents:write")}
                  defaultCategory={inflow ? "OTHER" : "PURCHASE_INVOICE"}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Votre accès ne permet pas de consulter les documents.</p>
              )}
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
          {canWrite && detail.payments.length === 0 && !transaction.isDuplicateSuspect ? (
            <div>
              <DeleteTransactionButton companyId={companyId} transactionId={transaction.id} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
