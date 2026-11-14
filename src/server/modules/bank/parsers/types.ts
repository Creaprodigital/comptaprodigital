import type { IsoDate } from "@/lib/dates";

export type StatementFormat = "CSV" | "OFX" | "CAMT053";

export type ParsedTransaction = {
  date: IsoDate;
  valueDate?: IsoDate;
  label: string;
  /** Montant signé au format décimal (« -12.50 ») : positif = encaissement, négatif = décaissement. */
  amount: string;
  /** Référence unique fournie par la banque (FITID, AcctSvcrRef), lorsqu'elle existe. */
  externalId?: string;
};

export type ParseIssue = { line?: number; message: string };

export type ParsedStatement = {
  format: StatementFormat;
  transactions: ParsedTransaction[];
  issues: ParseIssue[];
  currency?: string;
  /** IBAN ou numéro de compte lu dans le fichier (contrôle de cohérence avec le compte choisi). */
  accountRef?: string;
};

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}

/** Décodage du fichier : UTF-8 strict, sinon Windows-1252 (fréquent dans les exports bancaires français). */
export function decodeStatement(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** Libellé nettoyé pour l'affichage : espaces normalisés, longueur bornée. */
export function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 255);
}

/**
 * Montant bancaire → chaîne décimale signée, sans passer par un flottant.
 * Accepte « 1 234,56 », « -1.234,56 », « 1,234.56 », « 12,5- », « (12,50) », « +45.00 ».
 */
export function parseAmount(raw: string): string | null {
  let value = raw.replace(/[\s  €$£]|EUR/gi, "");
  if (!value) return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.endsWith("-")) {
    negative = !negative;
    value = value.slice(0, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Le dernier séparateur est le séparateur décimal, l'autre groupe les milliers.
    const decimal = lastComma > lastDot ? "," : ".";
    value = value.split(decimal === "," ? "." : ",").join("").replace(",", ".");
  } else if (lastComma >= 0) {
    value = value.replace(/,(?=.*,)/g, "").replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
  const normalized = `${integer.replace(/^0+(?=\d)/, "")}.${(fraction + "00").slice(0, 2)}`;
  if (integer.length > 13) return null;
  return negative && normalized !== "0.00" ? `-${normalized}` : normalized;
}

const DATE_PATTERNS: Array<{ regex: RegExp; build: (m: RegExpExecArray) => string }> = [
  { regex: /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  { regex: /^(\d{2})[/.\-](\d{2})[/.\-](\d{4})$/, build: (m) => `${m[3]}-${m[2]}-${m[1]}` },
  { regex: /^(\d{2})[/.\-](\d{2})[/.\-](\d{2})$/, build: (m) => `20${m[3]}-${m[2]}-${m[1]}` },
  { regex: /^(\d{4})(\d{2})(\d{2})/, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
];

/** Date d'opération → « AAAA-MM-JJ ». Les formats jour/mois français sont prioritaires. */
export function parseStatementDate(raw: string): IsoDate | null {
  const value = raw.trim();
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.regex.exec(value);
    if (!match) continue;
    const iso = pattern.build(match);
    const date = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso && iso >= "1990-01-01" && iso <= "2100-12-31") return iso;
    return null;
  }
  return null;
}
