import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { creditNoteSplit } from "@/server/modules/accounting/postings";
import { bankRemainder, bankRemainderVat, paymentVatByRate, purchasePaymentVat, purchaseVatOnInvoice, splitByRate, vatBreakdownOf, type RateRow } from "@/server/modules/accounting/rules";
import { dec, roundMoney, sum, toMoneyString, ZERO } from "@/lib/money";
import { fromIsoDate, toIsoDate, type IsoDate } from "@/lib/dates";

/**
 * Calcul de la TVA d'une période, opération par opération :
 *
 * TVA collectée
 *  - factures exigibles à la facturation (livraisons de biens, option pour les débits) : à leur date ;
 *  - factures exigibles à l'encaissement (prestations de services, acomptes) : au prorata de chaque règlement ;
 *  - avoirs : à leur date, pour la part qui porte sur des sommes déjà exigibles ;
 *  - encaissements bancaires catégorisés avec un taux de TVA (ventes sans facture).
 * TVA déductible
 *  - achats de biens ou fournisseur ayant opté pour les débits : à la date de la facture ;
 *  - achats de services : au prorata de chaque paiement ;
 *  - décaissements catégorisés avec un taux de TVA (dépenses sans facture d'achat saisie).
 *  La TVA sur immobilisations (comptes de classe 2) est isolée.
 *
 * Ces règles sont celles de la comptabilisation automatique (accounting/rules.ts) :
 * la déclaration et les comptes de TVA concordent.
 */

export type VatOperation = {
  date: string;
  kind: "INVOICE" | "CREDIT_NOTE" | "PAYMENT" | "BANK" | "PURCHASE" | "PURCHASE_PAYMENT";
  nature: "COLLECTED" | "DEDUCTIBLE" | "DEDUCTIBLE_ASSETS";
  reference: string;
  label: string;
  rate: string | null;
  base: string;
  vat: string;
  href: string | null;
};

export type VatComputation = {
  from: IsoDate;
  to: IsoDate;
  collectedByRate: Array<{ rate: string; base: string; vat: string }>;
  collected: string;
  deductibleGoodsServices: string;
  deductibleAssets: string;
  deductible: string;
  /** TVA brute − TVA déductible, avant imputation d'un crédit antérieur. */
  balance: string;
  operations: VatOperation[];
};

const KIND_LABELS = { INVOICE: "Facture", CREDIT_NOTE: "Avoir", PAYMENT: "Règlement", BANK: "Opération bancaire", PURCHASE: "Facture d'achat", PURCHASE_PAYMENT: "Paiement d'achat" } as const;
export { KIND_LABELS as VAT_OPERATION_LABELS };

export async function computeVat(companyId: string, from: IsoDate, to: IsoDate): Promise<VatComputation> {
  const db = tenantDb(companyId);
  const range = { gte: fromIsoDate(from), lte: fromIsoDate(to) };
  const itemSelect = { description: true, quantity: true, unitPriceExclTax: true, discountRate: true, vatRate: true, totalExclTax: true } as const;
  const [debitInvoices, payments, encCredits, transactions, purchases, purchasePayments] = await Promise.all([
    db.invoice.findMany({ where: { status: { notIn: ["DRAFT", "CANCELLED"] }, number: { not: null }, vatExigibility: "DEBITS", issueDate: range }, include: { items: { select: itemSelect }, customer: { select: { name: true } } } }),
    db.payment.findMany({
      where: { paidAt: range, invoice: { vatExigibility: "ENCAISSEMENTS", type: { in: ["INVOICE", "DEPOSIT"] }, status: { notIn: ["DRAFT", "CANCELLED"] } } },
      include: { invoice: { include: { items: { select: itemSelect }, customer: { select: { name: true } } } } },
    }),
    db.invoice.findMany({ where: { status: { notIn: ["DRAFT", "CANCELLED"] }, number: { not: null }, vatExigibility: "ENCAISSEMENTS", type: "CREDIT_NOTE", issueDate: range }, include: { items: { select: itemSelect }, customer: { select: { name: true } } } }),
    db.bankTransaction.findMany({
      where: { date: range, vatRate: { not: null }, purchaseId: null },
      include: { payments: { select: { amount: true } }, category: { select: { accountNumber: true } }, bankAccount: { select: { openingBalanceDate: true } } },
    }),
    db.purchase.findMany({ where: { status: { in: ["TO_PAY", "PAID"] }, issueDate: range }, include: { category: { select: { accountNumber: true } }, supplier: { select: { name: true } } } }),
    db.bankTransaction.findMany({ where: { date: range, purchaseId: { not: null } }, include: { purchase: { include: { category: { select: { accountNumber: true } }, supplier: { select: { name: true } } } }, bankAccount: { select: { openingBalanceDate: true } } } }),
  ]);

  const byRate = new Map<string, { base: Decimal; vat: Decimal }>();
  const addRate = (rows: RateRow[], sign: 1 | -1) => {
    for (const row of rows) {
      const key = row.rate.toFixed(2);
      const current = byRate.get(key) ?? { base: ZERO, vat: ZERO };
      byRate.set(key, { base: current.base.plus(row.base.times(sign)), vat: current.vat.plus(row.vat.times(sign)) });
    }
  };
  const operations: VatOperation[] = [];
  const op = (o: Omit<VatOperation, "base" | "vat" | "rate"> & { base: Decimal; vat: Decimal; rate?: Decimal | null }) =>
    operations.push({ ...o, rate: o.rate ? o.rate.toString() : null, base: toMoneyString(o.base), vat: toMoneyString(o.vat) });

  // Factures et avoirs exigibles à la facturation.
  for (const invoice of debitInvoices) {
    const sign = invoice.type === "CREDIT_NOTE" ? -1 : 1;
    const rows = vatBreakdownOf(invoice);
    addRate(rows, sign);
    for (const row of rows) op({ date: toIsoDate(invoice.issueDate!), kind: sign < 0 ? "CREDIT_NOTE" : "INVOICE", nature: "COLLECTED", reference: invoice.number!, label: invoice.customer.name, rate: row.rate, base: row.base.times(sign), vat: row.vat.times(sign), href: `/app/factures/${invoice.id}` });
  }
  // Règlements des factures exigibles à l'encaissement.
  for (const payment of payments) {
    const rows = paymentVatByRate(payment.invoice, payment.amount);
    addRate(rows, 1);
    for (const row of rows) op({ date: toIsoDate(payment.paidAt), kind: "PAYMENT", nature: "COLLECTED", reference: payment.invoice.number ?? "", label: payment.invoice.customer.name, rate: row.rate, base: row.base, vat: row.vat, href: `/app/factures/${payment.invoiceId}` });
  }
  // Avoirs sur factures à l'encaissement : part portant sur des sommes déjà encaissées.
  for (const credit of encCredits) {
    const split = await creditNoteSplit(prisma, companyId, credit);
    if (split.exigibleVat.isZero()) continue;
    const rows = splitByRate(vatBreakdownOf(credit), split.exigibleVat, split.exigibleBase);
    addRate(rows, -1);
    for (const row of rows) op({ date: toIsoDate(credit.issueDate!), kind: "CREDIT_NOTE", nature: "COLLECTED", reference: credit.number!, label: credit.customer.name, rate: row.rate, base: row.base.negated(), vat: row.vat.negated(), href: `/app/factures/${credit.id}` });
  }

  let deductible = ZERO;
  let deductibleAssets = ZERO;
  const addDeductible = (account: string | null | undefined, vat: Decimal) => {
    if ((account ?? "").startsWith("2")) deductibleAssets = deductibleAssets.plus(vat);
    else deductible = deductible.plus(vat);
    return (account ?? "").startsWith("2") ? ("DEDUCTIBLE_ASSETS" as const) : ("DEDUCTIBLE" as const);
  };

  // Opérations bancaires catégorisées avec un taux de TVA.
  for (const t of transactions) {
    if (t.bankAccount.openingBalanceDate && t.date < t.bankAccount.openingBalanceDate) continue;
    const remainder = bankRemainder(t);
    const vat = bankRemainderVat(t, remainder);
    if (vat.isZero()) continue;
    const base = remainder.abs().minus(vat);
    if (remainder.isPositive()) {
      addRate([{ rate: dec(t.vatRate), base, vat }], 1);
      op({ date: toIsoDate(t.date), kind: "BANK", nature: "COLLECTED", reference: t.externalId ?? "", label: t.label, rate: dec(t.vatRate), base, vat, href: `/app/banque/operations/${t.id}` });
    } else {
      const nature = addDeductible(t.category?.accountNumber, vat);
      op({ date: toIsoDate(t.date), kind: "BANK", nature, reference: t.externalId ?? "", label: t.label, rate: dec(t.vatRate), base, vat, href: `/app/banque/operations/${t.id}` });
    }
  }
  // Factures d'achat déductibles dès leur date.
  for (const p of purchases) {
    if (!purchaseVatOnInvoice(p) || dec(p.totalVat).isZero()) continue;
    const nature = addDeductible(p.category?.accountNumber, dec(p.totalVat));
    op({ date: toIsoDate(p.issueDate), kind: "PURCHASE", nature, reference: p.reference ?? "", label: p.supplier?.name ?? p.label, base: dec(p.totalExclTax), vat: dec(p.totalVat), href: `/app/achats/${p.id}` });
  }
  // Achats de services : TVA déductible au paiement.
  for (const t of purchasePayments) {
    const p = t.purchase!;
    if (t.bankAccount.openingBalanceDate && t.date < t.bankAccount.openingBalanceDate) continue;
    if (purchaseVatOnInvoice(p) || p.status === "CANCELLED") continue;
    const vat = purchasePaymentVat(p, dec(t.amount).negated());
    if (vat.isZero()) continue;
    const nature = addDeductible(p.category?.accountNumber, vat);
    op({ date: toIsoDate(t.date), kind: "PURCHASE_PAYMENT", nature, reference: p.reference ?? "", label: p.supplier?.name ?? p.label, base: roundMoney(dec(t.amount).negated().minus(vat)), vat, href: `/app/achats/${p.id}` });
  }

  const collectedByRate = [...byRate.entries()]
    .filter(([, v]) => !v.base.isZero() || !v.vat.isZero())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([rate, v]) => ({ rate: new Decimal(rate).toString(), base: toMoneyString(v.base), vat: toMoneyString(v.vat) }));
  const collected = sum([...byRate.values()].map((v) => v.vat));
  operations.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  return {
    from,
    to,
    collectedByRate,
    collected: toMoneyString(collected),
    deductibleGoodsServices: toMoneyString(deductible),
    deductibleAssets: toMoneyString(deductibleAssets),
    deductible: toMoneyString(deductible.plus(deductibleAssets)),
    balance: toMoneyString(collected.minus(deductible).minus(deductibleAssets)),
    operations,
  };
}
