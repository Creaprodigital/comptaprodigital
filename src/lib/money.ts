import Decimal from "decimal.js";

/**
 * Arithmétique monétaire exacte.
 *
 * Aucun calcul financier ne doit passer par le type `number` : on manipule des
 * `Decimal` et on sérialise en chaînes (« 1234.56 ») entre le serveur et le client.
 */

export type DecimalInput = Decimal.Value | { toString(): string };

export const ZERO = new Decimal(0);

export function dec(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO;
  if (Decimal.isDecimal(value)) return value as Decimal;
  return new Decimal(typeof value === "object" ? value.toString() : value);
}

/** Arrondi commercial au centime (demi supérieur en valeur absolue). */
export function roundMoney(value: DecimalInput): Decimal {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: Array<DecimalInput | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), ZERO);
}

/** Sérialisation canonique d'un montant : toujours deux décimales. */
export function toMoneyString(value: DecimalInput | null | undefined): string {
  return roundMoney(dec(value)).toFixed(2);
}

/** TVA d'un montant hors taxes pour un taux exprimé en pourcentage (20 = 20 %). */
export function vatFromExclTax(amountExclTax: DecimalInput, ratePercent: DecimalInput): Decimal {
  return roundMoney(dec(amountExclTax).times(dec(ratePercent)).dividedBy(100));
}

/**
 * Part de TVA contenue dans un encaissement partiel, au prorata de la facture.
 * Utilisée pour la TVA exigible sur les encaissements.
 */
export function vatShareOfPayment(
  paymentAmount: DecimalInput,
  invoiceTotalVat: DecimalInput,
  invoiceTotalInclTax: DecimalInput,
): Decimal {
  const total = dec(invoiceTotalInclTax);
  if (total.isZero()) return ZERO;
  return roundMoney(dec(paymentAmount).times(dec(invoiceTotalVat)).dividedBy(total));
}
