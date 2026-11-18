import Decimal from "decimal.js";
import { ACCOUNTS } from "@/config/chart-of-accounts";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoicing";
import { dec, roundMoney, sum, vatShareOfPayment, ZERO } from "@/lib/money";
import { allocateProportionally } from "@/lib/accounting";

/**
 * Règles fiscales et comptables partagées par la comptabilisation automatique
 * et la préparation des déclarations de TVA : une même règle produit l'écriture
 * et le montant déclaré, pour que comptabilité et déclaration concordent.
 */

/** Ligne d'acompte déduite d'une facture finale (voir invoicing/quotes.ts). */
export const DEPOSIT_DEDUCTION_PREFIX = "Acompte déjà facturé";

type ItemLike = { description: string; quantity: Decimal.Value; unitPriceExclTax: Decimal.Value; discountRate: Decimal.Value; vatRate: Decimal.Value; totalExclTax: Decimal.Value; product?: { accountNumber: string | null; type: string } | null };
type InvoiceLike = { type: string; operationCategory: string; discountType: string; discountValue: Decimal.Value; totalExclTax: Decimal.Value; totalVat: Decimal.Value; items: ItemLike[] };

/** Compte de produits d'une ligne de facture. */
export function revenueAccountFor(invoice: Pick<InvoiceLike, "type" | "operationCategory">, item: ItemLike): string {
  if (invoice.type === "DEPOSIT") return ACCOUNTS.customerDeposits;
  if (dec(item.totalExclTax).isNegative() && item.description.startsWith(DEPOSIT_DEDUCTION_PREFIX)) return ACCOUNTS.customerDeposits;
  if (item.product?.accountNumber) return item.product.accountNumber;
  if (item.product?.type === "GOOD" || invoice.operationCategory === "GOODS") return ACCOUNTS.goods;
  return ACCOUNTS.services;
}

export type RateRow = { rate: Decimal; base: Decimal; vat: Decimal };

/** Ventilation par taux (bases HT après remise et TVA), cohérente avec les totaux enregistrés. */
export function vatBreakdownOf(invoice: InvoiceLike): RateRow[] {
  try {
    const totals = computeDocumentTotals(
      invoice.items.map((i) => ({ quantity: i.quantity, unitPriceExclTax: i.unitPriceExclTax, discountRate: i.discountRate, vatRate: i.vatRate })),
      { type: invoice.discountType as DiscountType, value: invoice.discountValue },
    );
    if (totals.totalVat.equals(dec(invoice.totalVat)) && totals.totalExclTax.equals(dec(invoice.totalExclTax))) {
      return totals.vatBreakdown.filter((r) => !r.base.isZero() || !r.vat.isZero());
    }
  } catch {
    // Données anciennes ou incohérentes : ventilation globale ci-dessous.
  }
  const rate = dec(invoice.totalExclTax).isZero() ? ZERO : roundMoney(dec(invoice.totalVat).times(100).dividedBy(dec(invoice.totalExclTax)));
  return [{ rate, base: dec(invoice.totalExclTax), vat: dec(invoice.totalVat) }];
}

/** Répartit un montant de TVA (et la base correspondante) entre les taux d'une facture, au prorata. */
export function splitByRate(rows: RateRow[], vatAmount: Decimal.Value, baseAmount: Decimal.Value): RateRow[] {
  const vats = allocateProportionally(vatAmount, rows.map((r) => r.vat.abs()));
  const bases = allocateProportionally(baseAmount, rows.map((r) => r.base.abs()));
  return rows.map((r, i) => ({ rate: r.rate, base: bases[i], vat: vats[i] }));
}

/**
 * TVA d'un règlement sur une facture à l'encaissement : prorata du règlement
 * sur le total TTC de la facture, ventilé par taux.
 */
export function paymentVatByRate(invoice: InvoiceLike & { totalInclTax: Decimal.Value }, amount: Decimal.Value): RateRow[] {
  const vat = vatShareOfPayment(amount, invoice.totalVat, invoice.totalInclTax);
  const base = roundMoney(dec(amount).minus(vat));
  return splitByRate(vatBreakdownOf(invoice), vat, base);
}

/**
 * Avoir sur une facture à l'encaissement. La part de l'avoir qui annule un reste
 * à encaisser n'a jamais rendu de TVA exigible : elle diminue la TVA en attente.
 * La part qui porte sur des sommes déjà encaissées diminue la TVA collectée, à
 * la date de l'avoir.
 *
 * @param remainingBefore reste à encaisser de la facture d'origine à la date de
 *   l'avoir : TTC − règlements datés au plus tard ce jour − avoirs antérieurs.
 */
export function creditNoteVatSplit(creditNote: { totalInclTax: Decimal.Value; totalVat: Decimal.Value }, remainingBefore: Decimal.Value): { pendingVat: Decimal; exigibleVat: Decimal; exigibleBase: Decimal } {
  const ttc = dec(creditNote.totalInclTax);
  if (ttc.isZero()) return { pendingVat: ZERO, exigibleVat: ZERO, exigibleBase: ZERO };
  const pendingPortion = Decimal.max(ZERO, Decimal.min(ttc, dec(remainingBefore)));
  const exigiblePortion = ttc.minus(pendingPortion);
  const exigibleVat = roundMoney(dec(creditNote.totalVat).times(exigiblePortion).dividedBy(ttc));
  return { pendingVat: dec(creditNote.totalVat).minus(exigibleVat), exigibleVat, exigibleBase: exigiblePortion.minus(exigibleVat) };
}

/** Compte de TVA déductible selon le compte de charge ou d'immobilisation. */
export function deductibleVatAccount(expenseAccount: string): string {
  return expenseAccount.startsWith("2") ? ACCOUNTS.vatDeductibleAssets : ACCOUNTS.vatDeductible;
}

/** Une facture d'achat donne droit à déduction dès sa date (biens, option du fournisseur pour les débits). */
export function purchaseVatOnInvoice(purchase: { operationCategory: string; supplierVatOnDebits: boolean }): boolean {
  return purchase.operationCategory === "GOODS" || purchase.supplierVatOnDebits;
}

/** TVA déductible libérée par un règlement d'une facture d'achat de services. */
export function purchasePaymentVat(purchase: { totalVat: Decimal.Value; totalInclTax: Decimal.Value }, amount: Decimal.Value): Decimal {
  return vatShareOfPayment(amount, purchase.totalVat, purchase.totalInclTax);
}

/**
 * Part d'une opération bancaire qui n'est ni un règlement de facture client ni
 * un règlement de facture d'achat : elle est comptabilisée d'après sa catégorie.
 */
export function bankRemainder(transaction: { amount: Decimal.Value; purchaseId: string | null; payments: Array<{ amount: Decimal.Value }> }): Decimal {
  if (transaction.purchaseId) return ZERO;
  return dec(transaction.amount).minus(sum(transaction.payments.map((p) => p.amount)));
}

/** TVA comprise dans la part catégorisée d'une opération bancaire. */
export function bankRemainderVat(transaction: { amount: Decimal.Value; vatRate: Decimal.Value | null; vatAmount: Decimal.Value | null }, remainder: Decimal): Decimal {
  if (transaction.vatRate === null || remainder.isZero()) return ZERO;
  if (remainder.abs().equals(dec(transaction.amount).abs()) && transaction.vatAmount !== null) return dec(transaction.vatAmount).abs();
  const rate = dec(transaction.vatRate);
  return remainder.abs().times(rate).dividedBy(rate.plus(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
