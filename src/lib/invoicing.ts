import Decimal from "decimal.js";
import { dec, roundMoney, ZERO } from "@/lib/money";

/**
 * Calcul des totaux d'un devis ou d'une facture (module pur, partagé entre le
 * formulaire et le serveur — le serveur recalcule toujours, il ne fait jamais
 * confiance aux totaux reçus).
 *
 * Règles :
 *  - total HT d'une ligne = quantité × prix unitaire × (1 − remise %), arrondi au centime ;
 *  - la remise globale porte sur les lignes positives, répartie entre les taux de TVA au prorata des bases ;
 *  - la TVA est calculée par taux, sur la base HT nette de ce taux ;
 *  - une ligne peut être négative (déduction d'un acompte déjà facturé).
 */

export type DiscountType = "NONE" | "PERCENT" | "AMOUNT";

export type LineInput = {
  quantity: Decimal.Value;
  unitPriceExclTax: Decimal.Value;
  discountRate?: Decimal.Value | null;
  vatRate: Decimal.Value;
};

export type ComputedLine = { totalExclTax: Decimal; totalVat: Decimal; totalInclTax: Decimal };

export type VatBreakdownRow = { rate: Decimal; base: Decimal; vat: Decimal };

export type DocumentTotals = {
  lines: ComputedLine[];
  /** Somme des lignes, avant remise globale. */
  subtotalExclTax: Decimal;
  discountAmount: Decimal;
  vatBreakdown: VatBreakdownRow[];
  totalExclTax: Decimal;
  totalVat: Decimal;
  totalInclTax: Decimal;
};

export class InvoicingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicingError";
  }
}

export function computeLine(line: LineInput): ComputedLine {
  const discount = dec(line.discountRate ?? 0);
  const totalExclTax = roundMoney(dec(line.quantity).times(dec(line.unitPriceExclTax)).times(new Decimal(100).minus(discount)).dividedBy(100));
  const totalVat = roundMoney(totalExclTax.times(dec(line.vatRate)).dividedBy(100));
  return { totalExclTax, totalVat, totalInclTax: totalExclTax.plus(totalVat) };
}

export function computeDocumentTotals(
  lines: LineInput[],
  discount: { type: DiscountType; value: Decimal.Value } = { type: "NONE", value: 0 },
): DocumentTotals {
  const computed = lines.map(computeLine);
  const subtotalExclTax = computed.reduce((acc, line) => acc.plus(line.totalExclTax), ZERO);

  // Bases HT par taux de TVA. La remise globale ne porte que sur les lignes positives :
  // une ligne négative (acompte déjà facturé) est déduite après remise.
  const positiveBases = new Map<string, Decimal>();
  const deductions = new Map<string, Decimal>();
  lines.forEach((line, index) => {
    const key = dec(line.vatRate).toFixed(2);
    const amount = computed[index].totalExclTax;
    const target = amount.isNegative() ? deductions : positiveBases;
    target.set(key, (target.get(key) ?? ZERO).plus(amount));
  });
  const rates = [...new Set([...positiveBases.keys(), ...deductions.keys()])].sort((a, b) => Number(b) - Number(a));
  const discountBase = [...positiveBases.values()].reduce((acc, base) => acc.plus(base), ZERO);

  let discountAmount = ZERO;
  if (discount.type === "PERCENT") {
    const percent = dec(discount.value);
    if (percent.lessThan(0) || percent.greaterThan(100)) throw new InvoicingError("La remise doit être comprise entre 0 et 100 %.");
    discountAmount = roundMoney(discountBase.times(percent).dividedBy(100));
  } else if (discount.type === "AMOUNT") {
    discountAmount = roundMoney(dec(discount.value));
    if (discountAmount.lessThan(0)) throw new InvoicingError("La remise ne peut pas être négative.");
  }
  if (discountAmount.greaterThan(discountBase)) {
    throw new InvoicingError("La remise ne peut pas dépasser le total hors taxes.");
  }

  // Répartition de la remise au prorata des bases positives ; le dernier taux concerné absorbe l'écart d'arrondi.
  const discountedRates = rates.filter((key) => positiveBases.has(key));
  let remaining = discountAmount;
  const shares = new Map<string, Decimal>();
  discountedRates.forEach((key, index) => {
    const base = positiveBases.get(key)!;
    const share =
      index === discountedRates.length - 1 ? remaining : roundMoney(discountAmount.times(base).dividedBy(discountBase.isZero() ? 1 : discountBase));
    remaining = remaining.minus(share);
    shares.set(key, share);
  });

  const vatBreakdown: VatBreakdownRow[] = rates.map((key) => {
    const netBase = (positiveBases.get(key) ?? ZERO).minus(shares.get(key) ?? ZERO).plus(deductions.get(key) ?? ZERO);
    return { rate: new Decimal(key), base: netBase, vat: roundMoney(netBase.times(key).dividedBy(100)) };
  });

  const totalExclTax = subtotalExclTax.minus(discountAmount);
  const totalVat = vatBreakdown.reduce((acc, row) => acc.plus(row.vat), ZERO);
  return { lines: computed, subtotalExclTax, discountAmount, vatBreakdown, totalExclTax, totalVat, totalInclTax: totalExclTax.plus(totalVat) };
}

/** Numéro de document : préfixe, année, rang sur quatre chiffres (ex. F-2026-0042). */
export function formatDocumentNumber(prefix: string, year: number, rank: number): string {
  return `${prefix}-${year}-${String(rank).padStart(4, "0")}`;
}

/** Reste à encaisser d'une facture : total TTC − règlements − avoirs. */
export function remainingAmount(invoice: { totalInclTax: Decimal.Value; amountPaid: Decimal.Value; creditedAmount: Decimal.Value }): Decimal {
  return dec(invoice.totalInclTax).minus(dec(invoice.amountPaid)).minus(dec(invoice.creditedAmount));
}

export const INVOICE_STATUS_LABELS = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  SENT: "Envoyée",
  PARTIALLY_PAID: "Payée partiellement",
  PAID: "Payée",
  CANCELLED: "Annulée",
} as const;

export const INVOICE_TYPE_LABELS = { INVOICE: "Facture", DEPOSIT: "Facture d'acompte", CREDIT_NOTE: "Avoir" } as const;

export const QUOTE_STATUS_LABELS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
  INVOICED: "Facturé",
} as const;

export const PAYMENT_METHOD_LABELS = {
  TRANSFER: "Virement",
  CARD: "Carte bancaire",
  CHECK: "Chèque",
  CASH: "Espèces",
  DIRECT_DEBIT: "Prélèvement",
  OTHER: "Autre",
} as const;

export const OPERATION_CATEGORY_LABELS = {
  SERVICES: "Prestation de services",
  GOODS: "Livraison de biens",
  MIXED: "Opération mixte (biens et services)",
} as const;

export const RECURRENCE_LABELS = { WEEKLY: "Chaque semaine", MONTHLY: "Chaque mois", QUARTERLY: "Chaque trimestre", YEARLY: "Chaque année" } as const;

export const FRANCHISE_VAT_MENTION = "TVA non applicable, art. 293 B du CGI";
