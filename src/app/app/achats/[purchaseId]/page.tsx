import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { listCategories } from "@/server/modules/bank/categories";
import { documentsForEntity } from "@/server/modules/documents/service";
import { companyHasModule } from "@/server/modules/plans/service";
import { getPurchase, getPurchaseHistory, listSuppliers } from "@/server/modules/purchases/service";
import { todayInParis } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { OPERATION_CATEGORY_LABELS } from "@/lib/invoicing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HistoryList } from "@/components/app/billing/shared";
import { AttachedDocuments } from "@/components/app/documents/documents-view";
import { PurchaseActions, PurchaseStatusBadge } from "@/components/app/purchases/purchases-view";

export const metadata: Metadata = { title: "Facture d'achat" };
export const instant = false;

type Props = { params: Promise<{ purchaseId: string }> };

export default async function PurchasePage({ params }: Props) {
  const [{ access }, { purchaseId }] = await Promise.all([requireCompany("purchases:read"), params]);
  const purchase = await getPurchase(access, purchaseId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const companyId = access.company.id;
  const documentsEnabled = (await companyHasModule(companyId, "documents")) && access.permissions.has("documents:read");
  const [history, suppliers, categories, documents] = await Promise.all([
    getPurchaseHistory(access, purchaseId),
    listSuppliers(access),
    listCategories(companyId),
    documentsEnabled ? documentsForEntity(access, "PURCHASE", purchaseId) : [],
  ]);
  const money = (value: string) => formatCurrency(value, { currency: access.company.currency });
  const rows: Array<[string, string]> = [
    ["Fournisseur", purchase.supplier?.name ?? "Sans fournisseur identifié"],
    ["Numéro", purchase.reference ?? "—"],
    ["Date", formatDate(purchase.issueDate, "long")],
    ["Échéance", purchase.dueDate ? formatDate(purchase.dueDate, "long") : "—"],
    ["Catégorie", purchase.category ? `${purchase.category.name}${purchase.category.accountNumber ? ` (${purchase.category.accountNumber})` : ""}` : "—"],
    ["Nature", `${OPERATION_CATEGORY_LABELS[purchase.operationCategory]}${purchase.supplierVatOnDebits ? " — option du fournisseur pour les débits" : ""}`],
  ];

  return (
    <>
      <Link href="/app/achats" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Toutes les factures d'achat
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words sm:text-[28px]">{purchase.label}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{purchase.supplier?.name ?? "Sans fournisseur"}</span>
            <PurchaseStatusBadge purchase={purchase} />
          </p>
        </div>
        <PurchaseActions companyId={companyId} purchase={purchase} suppliers={suppliers} categories={categories} today={todayInParis()} canWrite={access.permissions.has("purchases:write")} />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle>Facture</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <dl className="mt-5 grid gap-2 border-t pt-4 text-sm">
                {[["Total HT", purchase.totalExclTax], ["TVA", purchase.totalVat], ["Total TTC", purchase.totalInclTax], ["Déjà réglé", purchase.amountPaid], ["Reste à payer", purchase.remaining]].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular font-semibold">{money(value)}</dd>
                  </div>
                ))}
              </dl>
              {purchase.notes ? <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm whitespace-pre-line">{purchase.notes}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Règlements</CardTitle></CardHeader>
            <CardContent>
              {purchase.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun règlement. Rapprochez le décaissement correspondant depuis le détail de l'opération bancaire.</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {purchase.payments.map((p) => (
                    <li key={p.transactionId} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
                      <span className="tabular text-muted-foreground">{formatDate(p.date)}</span>
                      <Link href={`/app/banque/operations/${p.transactionId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{p.label}</Link>
                      <span className="tabular font-semibold">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6">
          {documentsEnabled ? (
            <Card>
              <CardHeader><CardTitle>Facture du fournisseur</CardTitle></CardHeader>
              <CardContent>
                <AttachedDocuments companyId={companyId} link={{ entityType: "PURCHASE", entityId: purchase.id }} documents={documents} canWrite={access.permissions.has("documents:write")} defaultCategory="PURCHASE_INVOICE" />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent><HistoryList entries={history} /></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
