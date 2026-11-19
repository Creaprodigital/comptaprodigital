import type { Company, Customer, EntrySource, Prisma, Supplier } from "@prisma/client";
import Decimal from "decimal.js";
import { ACCOUNTS } from "@/config/chart-of-accounts";
import { dec, sum, vatShareOfPayment, ZERO } from "@/lib/money";
import { toIsoDate, type IsoDate } from "@/lib/dates";
import type { LineInput } from "./entries";
import type { Tx } from "./setup";
import { memo } from "./setup";
import {
  bankRemainder,
  bankRemainderVat,
  creditNoteVatSplit,
  deductibleVatAccount,
  purchasePaymentVat,
  purchaseVatOnInvoice,
  revenueAccountFor,
  splitByRate,
  vatBreakdownOf,
} from "./rules";

/**
 * Règles de comptabilisation automatique : à partir de l'état actuel d'une pièce,
 * l'écriture qu'elle doit produire (ou `null` si elle n'en produit pas).
 *
 *  Facture (VT)        411 client  /  706-707 (ou 4191 pour un acompte), 709 remise, TVA
 *                      (44571 si exigible à la facturation, 44581 en attente si à l'encaissement)
 *  Règlement client    512 banque, 530 caisse ou 511 valeurs à l'encaissement  /  411 client
 *                      + transfert 44581 → 44571 de la TVA devenue exigible
 *  Facture d'achat (AC) 6xx ou 2xx  +  TVA déductible (44566, 44562, ou 44582 en attente)  /  401-404
 *  Opération bancaire  512  /  401-404 si rapprochée d'une facture d'achat (+ 44582 → 44566),
 *                      sinon compte de la catégorie (471 compte d'attente si non catégorisée) et TVA
 */

export type SourceRef = { type: EntrySource; id: string };

export type ExpectedEntry = { journalCode: string; naturalDate: IsoDate; label: string; pieceRef: string; lines: LineInput[] };

type CompanyRef = Pick<Company, "id" | "fiscalYearStartMonth">;

const line = (accountNumber: string, label: string, debit: Decimal.Value, credit: Decimal.Value, aux?: { number: string; label: string }): LineInput => ({
  accountNumber,
  label,
  debit: dec(debit).toFixed(2),
  credit: dec(credit).toFixed(2),
  auxiliaryNumber: aux?.number ?? null,
  auxiliaryLabel: aux?.label ?? null,
});

/** Ligne au débit si le montant est positif, au crédit sinon (aucune ligne pour un montant nul). */
function signed(accountNumber: string, label: string, amount: Decimal, aux?: { number: string; label: string }): LineInput[] {
  if (amount.isZero()) return [];
  return [amount.isPositive() ? line(accountNumber, label, amount, 0, aux) : line(accountNumber, label, 0, amount.negated(), aux)];
}

/** Regroupe les lignes de même compte, même auxiliaire et même sens (écriture plus lisible). */
function compact(lines: LineInput[]): LineInput[] {
  const map = new Map<string, LineInput>();
  for (const l of lines) {
    const side = dec(l.debit).isZero() ? "C" : "D";
    const key = `${l.accountNumber}|${l.auxiliaryNumber ?? ""}|${side}`;
    const existing = map.get(key);
    if (existing) {
      existing.debit = dec(existing.debit).plus(dec(l.debit)).toFixed(2);
      existing.credit = dec(existing.credit).plus(dec(l.credit)).toFixed(2);
    } else map.set(key, { ...l });
  }
  return [...map.values()].filter((l) => !dec(l.debit).isZero() || !dec(l.credit).isZero());
}

/** Compte auxiliaire d'un client (C00001…), attribué à la première écriture. */
/** Formes de chargement des pièces, partagées avec le préchargement par lot (sync.ts). */
export const SOURCE_INCLUDES = {
  INVOICE: { customer: true, items: { include: { product: { select: { accountNumber: true, type: true } } }, orderBy: { position: "asc" } } },
  PAYMENT: { invoice: { include: { customer: true, items: { select: { description: true, quantity: true, unitPriceExclTax: true, discountRate: true, vatRate: true, totalExclTax: true } } } }, bankTransaction: { select: { bankAccountId: true } } },
  PURCHASE: { supplier: true, category: { select: { accountNumber: true, name: true } } },
  BANK_TRANSACTION: {
    payments: { select: { amount: true } },
    category: { select: { accountNumber: true, name: true, kind: true } },
    purchase: { include: { supplier: true, category: { select: { accountNumber: true } } } },
    bankAccount: { select: { openingBalanceDate: true } },
  },
} as const satisfies { INVOICE: Prisma.InvoiceInclude; PAYMENT: Prisma.PaymentInclude; PURCHASE: Prisma.PurchaseInclude; BANK_TRANSACTION: Prisma.BankTransactionInclude };

async function customerAux(tx: Tx, companyId: string, customer: Pick<Customer, "id" | "name" | "accountNumber">) {
  if (customer.accountNumber) return { number: customer.accountNumber, label: customer.name };
  // Pendant une synchronisation, le numéro attribué est réutilisé pour les pièces suivantes du même client.
  return memo(tx, `aux:customer:${customer.id}`, () => assignCustomerAux(tx, companyId, customer));
}

async function assignCustomerAux(tx: Tx, companyId: string, customer: Pick<Customer, "id" | "name" | "accountNumber">) {
  const number = await nextAuxNumber(tx, companyId, "C");
  await tx.customer.update({ where: { id: customer.id }, data: { accountNumber: number } });
  return { number, label: customer.name };
}

async function supplierAux(tx: Tx, companyId: string, supplier: Pick<Supplier, "id" | "name" | "accountNumber"> | null) {
  if (!supplier) return { number: "FDIVERS", label: "Fournisseurs divers" };
  if (supplier.accountNumber) return { number: supplier.accountNumber, label: supplier.name };
  return memo(tx, `aux:supplier:${supplier.id}`, () => assignSupplierAux(tx, companyId, supplier));
}

async function assignSupplierAux(tx: Tx, companyId: string, supplier: Pick<Supplier, "id" | "name" | "accountNumber">) {
  const number = await nextAuxNumber(tx, companyId, "F");
  await tx.supplier.update({ where: { id: supplier.id }, data: { accountNumber: number } });
  return { number, label: supplier.name };
}

async function nextAuxNumber(tx: Tx, companyId: string, prefix: "C" | "F"): Promise<string> {
  const rows =
    prefix === "C"
      ? await tx.$queryRaw<Array<{ n: string | null }>>`SELECT MAX(accountNumber) AS n FROM customers WHERE companyId = ${companyId} AND accountNumber REGEXP '^C[0-9]{5}$'`
      : await tx.$queryRaw<Array<{ n: string | null }>>`SELECT MAX(accountNumber) AS n FROM suppliers WHERE companyId = ${companyId} AND accountNumber REGEXP '^F[0-9]{5}$'`;
  const last = rows[0]?.n ? Number(rows[0].n.slice(1)) : 0;
  return `${prefix}${String(last + 1).padStart(5, "0")}`;
}

/** Journal et compte de trésorerie d'un compte bancaire. */
async function bankLedger(tx: Tx, companyId: string, bankAccountId: string): Promise<{ journalCode: string; account: string }> {
  return memo(tx, `bank-ledger:${companyId}:${bankAccountId}`, () => resolveBankLedger(tx, companyId, bankAccountId));
}

async function resolveBankLedger(tx: Tx, companyId: string, bankAccountId: string): Promise<{ journalCode: string; account: string }> {
  const journal = await tx.accountingJournal.findFirst({ where: { companyId, bankAccountId }, select: { code: true } });
  const account = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId }, select: { accountNumber: true } });
  return { journalCode: journal?.code ?? "OD", account: account?.accountNumber ?? ACCOUNTS.bank };
}

// --- Factures et avoirs -----------------------------------------------------------------

async function invoiceEntry(tx: Tx, company: CompanyRef, invoiceId: string): Promise<ExpectedEntry | null> {
  const invoice = await memo(tx, `source:INVOICE:${invoiceId}`, () => tx.invoice.findFirst({ where: { id: invoiceId, companyId: company.id }, include: SOURCE_INCLUDES.INVOICE }));
  if (!invoice || invoice.status === "DRAFT" || invoice.status === "CANCELLED" || !invoice.number || !invoice.issueDate) return null;
  const aux = await customerAux(tx, company.id, invoice.customer);
  const isCredit = invoice.type === "CREDIT_NOTE";
  const label = `${isCredit ? "Avoir" : invoice.type === "DEPOSIT" ? "Facture d'acompte" : "Facture"} ${invoice.number} — ${invoice.customer.name}`;
  const date = toIsoDate(invoice.issueDate);

  // Écriture d'une facture : le client au débit, les produits et la TVA au crédit (sens inversé pour un avoir).
  const credits: LineInput[] = [];
  for (const item of invoice.items) credits.push(...signed(revenueAccountFor(invoice, item), label, dec(item.totalExclTax).negated()));
  const discount = sum(invoice.items.map((i) => i.totalExclTax)).minus(dec(invoice.totalExclTax));
  credits.push(...signed(ACCOUNTS.discounts, `${label} — remise`, discount));

  const breakdown = vatBreakdownOf(invoice);
  const vatLines: LineInput[] = [];
  if (invoice.vatExigibility === "DEBITS") {
    for (const row of breakdown) vatLines.push(...signed(ACCOUNTS.vatCollected, `TVA ${row.rate.toString()} %`, row.vat.negated()));
  } else if (!isCredit) {
    for (const row of breakdown) vatLines.push(...signed(ACCOUNTS.vatCollectedPending, `TVA ${row.rate.toString()} % en attente d'encaissement`, row.vat.negated()));
  } else {
    const split = await creditNoteSplit(tx, company.id, invoice);
    const pending = splitByRate(breakdown, split.pendingVat, ZERO);
    const exigible = splitByRate(breakdown, split.exigibleVat, ZERO);
    breakdown.forEach((row, i) => {
      vatLines.push(...signed(ACCOUNTS.vatCollectedPending, `TVA ${row.rate.toString()} % en attente d'encaissement`, pending[i].vat.negated()));
      vatLines.push(...signed(ACCOUNTS.vatCollected, `TVA ${row.rate.toString()} % sur sommes encaissées`, exigible[i].vat.negated()));
    });
  }
  let lines = [...signed(ACCOUNTS.customers, label, dec(invoice.totalInclTax), aux), ...credits, ...vatLines];
  if (isCredit) lines = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
  return { journalCode: "VT", naturalDate: date, label, pieceRef: invoice.number, lines: compact(lines) };
}

/** Reste à encaisser de la facture d'origine à la date d'un avoir (voir creditNoteVatSplit). */
export async function creditNoteSplit(tx: Tx, companyId: string, creditNote: { id: string; originalInvoiceId: string | null; issueDate: Date | null; totalInclTax: Decimal.Value; totalVat: Decimal.Value; number: string | null }) {
  if (!creditNote.originalInvoiceId || !creditNote.issueDate) return creditNoteVatSplit(creditNote, 0);
  const original = await tx.invoice.findFirst({ where: { id: creditNote.originalInvoiceId, companyId }, select: { totalInclTax: true } });
  const [paid, priorCredits] = await Promise.all([
    tx.payment.aggregate({ where: { companyId, invoiceId: creditNote.originalInvoiceId, paidAt: { lte: creditNote.issueDate } }, _sum: { amount: true } }),
    tx.invoice.findMany({
      where: { companyId, originalInvoiceId: creditNote.originalInvoiceId, type: "CREDIT_NOTE", status: { not: "DRAFT" }, id: { not: creditNote.id } },
      select: { issueDate: true, number: true, totalInclTax: true },
    }),
  ]);
  const before = priorCredits.filter((c) => c.issueDate && (c.issueDate < creditNote.issueDate! || (c.issueDate.getTime() === creditNote.issueDate!.getTime() && (c.number ?? "") < (creditNote.number ?? ""))));
  const remaining = dec(original?.totalInclTax).minus(dec(paid._sum.amount)).minus(sum(before.map((c) => c.totalInclTax)));
  return creditNoteVatSplit(creditNote, remaining);
}

// --- Règlements clients ------------------------------------------------------------------

async function paymentEntry(tx: Tx, company: CompanyRef, paymentId: string): Promise<ExpectedEntry | null> {
  const payment = await memo(tx, `source:PAYMENT:${paymentId}`, () => tx.payment.findFirst({ where: { id: paymentId, companyId: company.id }, include: SOURCE_INCLUDES.PAYMENT }));
  if (!payment) return null;
  const invoice = payment.invoice;
  const number = invoice.number;
  if (invoice.status === "DRAFT" || !number) return null;
  const aux = await customerAux(tx, company.id, invoice.customer);
  const amount = dec(payment.amount);
  // Règlement rapproché d'une opération bancaire : banque ; espèces : caisse ; sinon valeurs à l'encaissement.
  let journalCode = "OD";
  let treasury: string = ACCOUNTS.pendingCollection;
  if (payment.bankTransaction) {
    const ledger = await bankLedger(tx, company.id, payment.bankTransaction.bankAccountId);
    journalCode = ledger.journalCode;
    treasury = ledger.account;
  } else if (payment.method === "CASH") {
    journalCode = "CA";
    treasury = ACCOUNTS.cash;
  }
  const label = `Règlement ${number} — ${invoice.customer.name}`;
  const lines: LineInput[] = [line(treasury, label, amount, 0), line(ACCOUNTS.customers, label, 0, amount, aux)];
  if (invoice.vatExigibility === "ENCAISSEMENTS") {
    const vat = vatShareOfPayment(payment.amount, invoice.totalVat, invoice.totalInclTax);
    if (!vat.isZero()) lines.push(line(ACCOUNTS.vatCollectedPending, `${label} — TVA devenue exigible`, vat, 0), line(ACCOUNTS.vatCollected, `${label} — TVA devenue exigible`, 0, vat));
  }
  return { journalCode, naturalDate: toIsoDate(payment.paidAt), label, pieceRef: number, lines };
}

// --- Achats -----------------------------------------------------------------------------

async function purchaseEntry(tx: Tx, company: CompanyRef, purchaseId: string): Promise<ExpectedEntry | null> {
  const purchase = await memo(tx, `source:PURCHASE:${purchaseId}`, () => tx.purchase.findFirst({ where: { id: purchaseId, companyId: company.id }, include: SOURCE_INCLUDES.PURCHASE }));
  if (!purchase || purchase.status === "DRAFT" || purchase.status === "CANCELLED") return null;
  const aux = await supplierAux(tx, company.id, purchase.supplier);
  const expense = purchase.category?.accountNumber ?? ACCOUNTS.suspense;
  const payable = expense.startsWith("2") ? "404000" : ACCOUNTS.suppliers;
  const label = `${purchase.supplier?.name ?? "Achat"} — ${purchase.reference ?? purchase.label}`.slice(0, 255);
  const vatAccount = purchaseVatOnInvoice(purchase) ? deductibleVatAccount(expense) : ACCOUNTS.vatDeductiblePending;
  const lines: LineInput[] = [
    line(expense, label, purchase.totalExclTax, 0),
    ...signed(vatAccount, `${label} — TVA`, dec(purchase.totalVat)),
    line(payable, label, 0, purchase.totalInclTax, aux),
  ];
  return { journalCode: "AC", naturalDate: toIsoDate(purchase.issueDate), label, pieceRef: purchase.reference ?? `ACH-${purchase.id.slice(-8)}`, lines };
}

// --- Opérations bancaires -----------------------------------------------------------------

async function bankTransactionEntry(tx: Tx, company: CompanyRef, transactionId: string): Promise<ExpectedEntry | null> {
  const transaction = await memo(tx, `source:BANK_TRANSACTION:${transactionId}`, () => tx.bankTransaction.findFirst({ where: { id: transactionId, companyId: company.id }, include: SOURCE_INCLUDES.BANK_TRANSACTION }));
  if (!transaction) return null;
  // Opérations antérieures au solde d'ouverture : déjà comprises dans ce solde.
  if (transaction.bankAccount.openingBalanceDate && transaction.date < transaction.bankAccount.openingBalanceDate) return null;
  const { journalCode, account: treasury } = await bankLedger(tx, company.id, transaction.bankAccountId);
  const label = transaction.label;
  const pieceRef = (transaction.externalId ?? `OP-${transaction.id.slice(-8)}`).slice(0, 100);
  const date = toIsoDate(transaction.date);
  const amount = dec(transaction.amount);

  if (transaction.purchase) {
    const purchase = transaction.purchase;
    const aux = await supplierAux(tx, company.id, purchase.supplier);
    const expense = purchase.category?.accountNumber ?? ACCOUNTS.suspense;
    const payable = expense.startsWith("2") ? "404000" : ACCOUNTS.suppliers;
    const paid = amount.negated();
    const lines: LineInput[] = [line(payable, label, paid, 0, aux), line(treasury, label, 0, paid)];
    if (!purchaseVatOnInvoice(purchase)) {
      const vat = purchasePaymentVat(purchase, paid);
      if (!vat.isZero()) lines.push(line(deductibleVatAccount(expense), `${label} — TVA devenue déductible`, vat, 0), line(ACCOUNTS.vatDeductiblePending, `${label} — TVA devenue déductible`, 0, vat));
    }
    return { journalCode, naturalDate: date, label, pieceRef, lines };
  }

  const remainder = bankRemainder(transaction);
  if (remainder.isZero()) return null;
  const counterpart = transaction.category?.accountNumber ?? ACCOUNTS.suspense;
  const vat = bankRemainderVat(transaction, remainder);
  const inflow = remainder.isPositive();
  const vatAccount = inflow ? ACCOUNTS.vatCollected : deductibleVatAccount(counterpart);
  const net = remainder.abs().minus(vat);
  const lines: LineInput[] = inflow
    ? [line(treasury, label, remainder, 0), line(counterpart, label, 0, net), ...(vat.isZero() ? [] : [line(vatAccount, `${label} — TVA`, 0, vat)])]
    : [line(counterpart, label, net, 0), ...(vat.isZero() ? [] : [line(vatAccount, `${label} — TVA`, vat, 0)]), line(treasury, label, 0, remainder.abs())];
  return { journalCode, naturalDate: date, label, pieceRef, lines };
}

// --- Solde d'ouverture d'un compte bancaire --------------------------------------------------

async function openingBalanceEntry(tx: Tx, company: CompanyRef, bankAccountId: string): Promise<ExpectedEntry | null> {
  const account = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId: company.id } });
  if (!account || dec(account.openingBalance).isZero()) return null;
  const firstYear = await tx.fiscalYear.findFirst({ where: { companyId: company.id }, orderBy: { startDate: "asc" } });
  const date = account.openingBalanceDate ? toIsoDate(account.openingBalanceDate) : firstYear ? toIsoDate(firstYear.startDate) : toIsoDate(account.createdAt);
  const label = `Solde d'ouverture — ${account.name}`;
  const { account: treasury } = await bankLedger(tx, company.id, account.id);
  // La contrepartie (capital, compte courant d'associé, à-nouveaux de l'exercice précédent…) est à
  // reclasser depuis le compte d'attente par une écriture d'opérations diverses.
  return { journalCode: "AN", naturalDate: date, label, pieceRef: `OUV-${account.id.slice(-8)}`, lines: [...signed(treasury, label, dec(account.openingBalance)), ...signed(ACCOUNTS.suspense, label, dec(account.openingBalance).negated())] };
}

// --- Amortissements, cessions, TVA ------------------------------------------------------------

async function depreciationEntry(tx: Tx, company: CompanyRef, fiscalYearId: string): Promise<ExpectedEntry | null> {
  const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId: company.id } });
  if (!fiscalYear) return null;
  const rows = await tx.fixedAssetDepreciation.findMany({ where: { fiscalYearId, fixedAsset: { companyId: company.id } }, include: { fixedAsset: true }, orderBy: { fixedAsset: { label: "asc" } } });
  const positive = rows.filter((r) => dec(r.amount).greaterThan(0));
  if (positive.length === 0) return null;
  const label = `Dotations aux amortissements — ${fiscalYear.label}`;
  const lines: LineInput[] = [line(ACCOUNTS.depreciationExpense, label, sum(positive.map((r) => r.amount)), 0)];
  for (const row of positive) lines.push(line(row.fixedAsset.depreciationAccountNumber, `Amortissement — ${row.fixedAsset.label}`, 0, row.amount));
  return { journalCode: "OD", naturalDate: toIsoDate(fiscalYear.endDate), label, pieceRef: `AMORT-${toIsoDate(fiscalYear.endDate).slice(0, 4)}`, lines: compact(lines) };
}

async function disposalEntry(tx: Tx, company: CompanyRef, assetId: string): Promise<ExpectedEntry | null> {
  const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, companyId: company.id }, include: { depreciations: true } });
  if (!asset || asset.status !== "DISPOSED" || !asset.disposedAt) return null;
  const cumulated = sum(asset.depreciations.map((d) => d.amount));
  const netValue = dec(asset.cost).minus(cumulated);
  const price = dec(asset.disposalPrice);
  const label = `Sortie d'immobilisation — ${asset.label}`;
  const lines: LineInput[] = [
    ...signed(asset.depreciationAccountNumber, label, cumulated),
    ...signed(ACCOUNTS.disposedAssetValue, `${label} — valeur nette comptable`, netValue),
    line(asset.assetAccountNumber, label, 0, asset.cost),
    ...signed(ACCOUNTS.disposalReceivable, `${label} — prix de cession`, price),
    ...signed(ACCOUNTS.disposalProceeds, `${label} — prix de cession`, price.negated()),
  ];
  return { journalCode: "OD", naturalDate: toIsoDate(asset.disposedAt), label, pieceRef: `CESS-${asset.id.slice(-8)}`, lines };
}

async function vatReturnEntry(tx: Tx, company: CompanyRef, vatPeriodId: string): Promise<ExpectedEntry | null> {
  const period = await tx.vatPeriod.findFirst({ where: { id: vatPeriodId, companyId: company.id } });
  if (!period || (period.status !== "VALIDATED" && period.status !== "DECLARED")) return null;
  const label = `Déclaration de TVA du ${toIsoDate(period.startDate).split("-").reverse().join("/")} au ${toIsoDate(period.endDate).split("-").reverse().join("/")}`;
  const net = dec(period.netVatDue);
  const lines: LineInput[] = [
    ...signed(ACCOUNTS.vatCollected, label, dec(period.collectedVat)),
    ...signed(ACCOUNTS.vatDeductible, label, dec(period.deductibleVat).negated()),
    ...signed(ACCOUNTS.vatDeductibleAssets, label, dec(period.deductibleVatAssets).negated()),
    ...signed(ACCOUNTS.vatCredit, `${label} — crédit antérieur imputé`, dec(period.creditCarriedOver).negated()),
    ...(net.isNegative() ? signed(ACCOUNTS.vatCredit, `${label} — crédit à reporter`, net.negated()) : signed(ACCOUNTS.vatToPay, `${label} — TVA à décaisser`, net.negated())),
  ];
  if (lines.length < 2) return null;
  return { journalCode: "OD", naturalDate: toIsoDate(period.endDate), label, pieceRef: `TVA-${toIsoDate(period.endDate).slice(0, 7)}`, lines: compact(lines) };
}

/** Écriture attendue pour une pièce. */
export async function expectedEntryFor(tx: Tx, company: CompanyRef, ref: SourceRef): Promise<ExpectedEntry | null> {
  switch (ref.type) {
    case "INVOICE":
      return invoiceEntry(tx, company, ref.id);
    case "PAYMENT":
      return paymentEntry(tx, company, ref.id);
    case "PURCHASE":
      return purchaseEntry(tx, company, ref.id);
    case "BANK_TRANSACTION":
      return bankTransactionEntry(tx, company, ref.id);
    case "OPENING":
      return openingBalanceEntry(tx, company, ref.id);
    case "DEPRECIATION":
      return depreciationEntry(tx, company, ref.id);
    case "ASSET_DISPOSAL":
      return disposalEntry(tx, company, ref.id);
    case "VAT_RETURN":
      return vatReturnEntry(tx, company, ref.id);
    default:
      return null;
  }
}
