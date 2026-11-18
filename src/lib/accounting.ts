import Decimal from "decimal.js";
import { dec, ZERO } from "@/lib/money";

/** Règles de la partie double, partagées entre le serveur et les formulaires de saisie. */

export type EntryLineDraft = { accountNumber: string; label?: string; debit: Decimal.Value; credit: Decimal.Value };

export type EntryCheck = { totalDebit: Decimal; totalCredit: Decimal; balanced: boolean; errors: string[] };

export const ACCOUNT_NUMBER_PATTERN = /^[1-7]\d{2,9}$/;

/**
 * Contrôles d'une écriture : au moins deux lignes, chaque ligne au débit OU au
 * crédit (montant positif, deux décimales au plus), total des débits égal au
 * total des crédits.
 */
export function checkEntryLines(lines: EntryLineDraft[]): EntryCheck {
  const errors: string[] = [];
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  if (lines.length < 2) errors.push("Une écriture comporte au moins deux lignes.");
  lines.forEach((line, index) => {
    const position = `Ligne ${index + 1}`;
    if (!ACCOUNT_NUMBER_PATTERN.test(line.accountNumber)) errors.push(`${position} : numéro de compte invalide.`);
    const debit = dec(line.debit);
    const credit = dec(line.credit);
    if (debit.isNegative() || credit.isNegative()) errors.push(`${position} : un montant ne peut pas être négatif.`);
    if (debit.decimalPlaces() > 2 || credit.decimalPlaces() > 2) errors.push(`${position} : deux décimales au maximum.`);
    if (debit.isZero() === credit.isZero()) errors.push(`${position} : renseignez soit un débit, soit un crédit.`);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
  });
  const balanced = totalDebit.equals(totalCredit) && totalDebit.greaterThan(0);
  if (!totalDebit.equals(totalCredit)) {
    errors.push(`L'écriture n'est pas équilibrée : ${totalDebit.toFixed(2)} au débit, ${totalCredit.toFixed(2)} au crédit.`);
  }
  return { totalDebit, totalCredit, balanced: balanced && errors.length === 0, errors };
}

/** Solde d'un compte : positif = débiteur, négatif = créditeur. */
export function balanceOf(debit: Decimal.Value, credit: Decimal.Value): Decimal {
  return dec(debit).minus(dec(credit));
}

/** Code de lettrage suivant : A … Z, AA … ZZ, AAA… */
export function nextLetter(previous: string | null): string {
  if (!previous) return "A";
  const chars = previous.split("");
  let index = chars.length - 1;
  while (index >= 0) {
    if (chars[index] !== "Z") {
      chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[index] = "A";
    index--;
  }
  return `A${chars.join("")}`;
}

/** Compare deux codes de lettrage (A < Z < AA < AZ < BA…). */
export function compareLetters(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/**
 * Répartit un montant proportionnellement à des poids, au centime, sans écart
 * d'arrondi : la somme des parts est exactement égale au montant.
 */
export function allocateProportionally(amount: Decimal.Value, weights: Decimal.Value[]): Decimal[] {
  const total = weights.reduce<Decimal>((acc, w) => acc.plus(dec(w)), ZERO);
  const target = dec(amount);
  if (weights.length === 0) return [];
  if (total.isZero()) return weights.map((_, i) => (i === 0 ? target : ZERO));
  const cents = target.times(100);
  const raw = weights.map((w) => cents.times(dec(w)).dividedBy(total));
  const floors = raw.map((r) => r.toDecimalPlaces(0, Decimal.ROUND_DOWN));
  let rest = cents.minus(floors.reduce((acc, f) => acc.plus(f), ZERO)).toNumber();
  const order = raw.map((r, i) => ({ i, frac: r.minus(floors[i]).abs().toNumber() })).sort((a, b) => b.frac - a.frac);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0 && k < order.length * 2; k++) {
    floors[order[k % order.length].i] = floors[order[k % order.length].i].plus(step);
    rest -= step;
  }
  return floors.map((f) => f.dividedBy(100));
}

export const JOURNAL_TYPE_LABELS = { SALES: "Ventes", PURCHASES: "Achats", BANK: "Banque", MISC: "Opérations diverses", OPENING: "À-nouveaux" } as const;

export const ENTRY_SOURCE_LABELS = {
  MANUAL: "Saisie manuelle",
  INVOICE: "Facture",
  PAYMENT: "Règlement client",
  PURCHASE: "Facture d'achat",
  BANK_TRANSACTION: "Opération bancaire",
  DEPRECIATION: "Dotation aux amortissements",
  CLOSING: "Clôture",
  OPENING: "À-nouveaux",
  VAT_RETURN: "Déclaration de TVA",
  ASSET_DISPOSAL: "Sortie d'immobilisation",
} as const;
