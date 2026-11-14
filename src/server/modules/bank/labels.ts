import { createHash } from "node:crypto";
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
  const absolute = Math.abs(Number(transaction.amount));
  if (rule.amountMin !== null && absolute < Number(rule.amountMin.toString())) return false;
  if (rule.amountMax !== null && absolute > Number(rule.amountMax.toString())) return false;
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
