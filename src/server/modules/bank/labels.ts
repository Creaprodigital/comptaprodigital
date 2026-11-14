import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { ParsedTransaction } from "./parsers/types";

/** Libellé normalisé pour les comparaisons : majuscules, sans accents ni ponctuation superflue. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Empreintes de détection des doublons. Deux opérations identiques le même jour
 * (même montant, même libellé) sont légitimes : le rang d'apparition dans le
 * fichier entre dans l'empreinte, de sorte que réimporter le même relevé — ou un
 * relevé qui recouvre la même période — ne crée aucun doublon.
 */
export function fingerprintTransactions(transactions: ParsedTransaction[]): string[] {
  const occurrences = new Map<string, number>();
  return transactions.map((transaction) => {
    const base = `${transaction.date}|${transaction.amount}|${normalizeLabel(transaction.label)}`;
    const rank = occurrences.get(base) ?? 0;
    occurrences.set(base, rank + 1);
    return createHash("sha256").update(`${base}|${rank}`).digest("hex");
  });
}

export type RuleLike = {
  matchType: "CONTAINS" | "STARTS_WITH" | "EQUALS" | "REGEX";
  pattern: string;
  direction: string | null;
  amountMin: { toString(): string } | null;
  amountMax: { toString(): string } | null;
};

/** Indique si une règle de catégorisation s'applique à une opération. Les expressions régulières ne sont pas évaluées. */
export function ruleMatches(rule: RuleLike, transaction: { label: string; amount: string }): boolean {
  const negative = transaction.amount.startsWith("-");
  if (rule.direction === "IN" && negative) return false;
  if (rule.direction === "OUT" && !negative) return false;
  const absolute = new Decimal(transaction.amount).abs();
  if (rule.amountMin !== null && absolute.lessThan(rule.amountMin.toString())) return false;
  if (rule.amountMax !== null && absolute.greaterThan(rule.amountMax.toString())) return false;
  const label = normalizeLabel(transaction.label);
  const pattern = normalizeLabel(rule.pattern);
  if (!pattern) return false;
  switch (rule.matchType) {
    case "CONTAINS":
      return label.includes(pattern);
    case "STARTS_WITH":
      return label.startsWith(pattern);
    case "EQUALS":
      return label === pattern;
    default:
      return false;
  }
}

/** Part de TVA comprise dans un montant TTC, pour un taux donné (arrondie au centime). */
export function vatIncluded(amount: string | { toString(): string }, ratePercent: string | { toString(): string }): string {
  const rate = new Decimal(ratePercent.toString());
  return new Decimal(amount.toString()).abs().times(rate).dividedBy(rate.plus(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
