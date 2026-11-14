import { cleanLabel, parseAmount, parseStatementDate, StatementParseError, type ParsedStatement, type ParsedTransaction, type ParseIssue } from "./types";

/**
 * Relevés CSV. Les banques n'ont pas de format commun : le séparateur, la ligne
 * d'en-tête et le rôle des colonnes sont détectés, puis proposés à l'utilisateur
 * qui confirme ou corrige la correspondance avant l'import.
 */

export type CsvMapping = {
  date: number;
  label: number;
  /** Colonne de montant signé, ou couple débit / crédit. */
  amount?: number;
  debit?: number;
  credit?: number;
  valueDate?: number;
  /** Colonne complémentaire ajoutée au libellé (ex. « Détail »). */
  labelExtra?: number;
};

export type CsvTable = { delimiter: string; headerIndex: number; headers: string[]; rows: Array<{ line: number; cells: string[] }> };

const MAX_ROWS = 20_000;

function detectDelimiter(lines: string[]): string {
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = lines.map((line) => splitCsvLine(line, delimiter).length - 1).filter((count) => count > 0);
    if (counts.length === 0) continue;
    // Un bon séparateur apparaît souvent, et le même nombre de fois sur chaque ligne.
    const mode = counts.sort((a, b) => counts.filter((c) => c === a).length - counts.filter((c) => c === b).length).at(-1)!;
    const score = counts.filter((c) => c === mode).length * mode;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"' && current.trim() === "") quoted = true;
    else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** Découpe en lignes logiques (un champ entre guillemets peut contenir un saut de ligne). */
function logicalLines(text: string): Array<{ line: number; content: string }> {
  const lines: Array<{ line: number; content: string }> = [];
  let buffer = "";
  let start = 1;
  let number = 0;
  for (const physical of text.split(/\r\n|\n|\r/)) {
    number++;
    buffer = buffer ? `${buffer}\n${physical}` : physical;
    if ((buffer.match(/"/g)?.length ?? 0) % 2 === 0) {
      if (buffer.trim()) lines.push({ line: start, content: buffer });
      buffer = "";
      start = number + 1;
    }
  }
  if (buffer.trim()) lines.push({ line: start, content: buffer });
  return lines;
}

const HEADER_HINTS = /date|libell|label|description|montant|amount|d[ée]bit|cr[ée]dit|valeur|intitul|op[ée]ration|d[ée]tail/i;

export function readCsvTable(text: string): CsvTable {
  const lines = logicalLines(text);
  if (lines.length < 2) throw new StatementParseError("Le fichier ne contient aucune opération.");
  if (lines.length > MAX_ROWS) throw new StatementParseError(`Le fichier dépasse ${MAX_ROWS.toLocaleString("fr-FR")} lignes : importez-le par périodes plus courtes.`);
  const delimiter = detectDelimiter(lines.slice(0, 30).map((l) => l.content));
  const rows = lines.map((l) => ({ line: l.line, cells: splitCsvLine(l.content, delimiter) }));

  // L'en-tête est la première ligne (parmi les 20 premières) dont au moins deux cellules ressemblent à des intitulés.
  let headerIndex = rows.slice(0, 20).findIndex((row) => row.cells.filter((cell) => HEADER_HINTS.test(cell) && !/\d{2}[/.\-]\d{2}/.test(cell)).length >= 2);
  let headers: string[];
  if (headerIndex === -1) {
    // Pas d'en-tête : colonnes nommées par leur rang.
    headerIndex = -1;
    const width = Math.max(...rows.slice(0, 20).map((row) => row.cells.length));
    headers = Array.from({ length: width }, (_, i) => `Colonne ${i + 1}`);
  } else {
    headers = rows[headerIndex].cells.map((cell, i) => cell || `Colonne ${i + 1}`);
  }
  return { delimiter, headerIndex, headers, rows: rows.slice(headerIndex + 1) };
}

/** Proposition de correspondance des colonnes d'après leurs intitulés, ou d'après leur contenu en l'absence d'en-tête. */
export function guessCsvMapping(table: CsvTable): Partial<CsvMapping> {
  const find = (test: (header: string) => boolean) => {
    const index = table.headers.findIndex((header) => test(header.toLowerCase()));
    return index >= 0 ? index : undefined;
  };
  const mapping: Partial<CsvMapping> = {
    valueDate: find((h) => /valeur/.test(h) && /date/.test(h)),
    date: find((h) => /date/.test(h) && !/valeur/.test(h)),
    debit: find((h) => /d[ée]bit/.test(h)),
    credit: find((h) => /cr[ée]dit/.test(h)),
    amount: find((h) => /montant|amount|somme/.test(h) && !/d[ée]bit|cr[ée]dit|devise/.test(h)),
    label: find((h) => /libell|label|description|intitul|motif|nature/.test(h)),
  };
  const extra = find((h) => /d[ée]tail|compl[ée]ment|r[ée]f[ée]rence|information/.test(h));
  if (extra !== undefined && extra !== mapping.label) mapping.labelExtra = extra;

  // Sans intitulés exploitables : on reconnaît les colonnes à leur contenu.
  const sample = table.rows.slice(0, 25);
  const columnMatches = (index: number, test: (cell: string) => boolean) => sample.length > 0 && sample.filter((row) => test(row.cells[index] ?? "")).length >= sample.length * 0.7;
  const width = table.headers.length;
  if (mapping.date === undefined) {
    for (let i = 0; i < width; i++) if (i !== mapping.valueDate && columnMatches(i, (cell) => parseStatementDate(cell) !== null)) { mapping.date = i; break; }
  }
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    for (let i = width - 1; i >= 0; i--) if (i !== mapping.date && columnMatches(i, (cell) => /[\d]/.test(cell) && parseAmount(cell) !== null && parseStatementDate(cell) === null)) { mapping.amount = i; break; }
  }
  if (mapping.label === undefined) {
    let bestLength = 0;
    for (let i = 0; i < width; i++) {
      if ([mapping.date, mapping.valueDate, mapping.amount, mapping.debit, mapping.credit].includes(i)) continue;
      const average = sample.reduce((acc, row) => acc + (row.cells[i]?.length ?? 0), 0) / Math.max(1, sample.length);
      if (average > bestLength && sample.some((row) => /[A-Za-zÀ-ÿ]{3}/.test(row.cells[i] ?? ""))) {
        bestLength = average;
        mapping.label = i;
      }
    }
  }
  return Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== undefined));
}

export function isCompleteMapping(mapping: Partial<CsvMapping>): mapping is CsvMapping {
  return mapping.date !== undefined && mapping.label !== undefined && (mapping.amount !== undefined || mapping.debit !== undefined || mapping.credit !== undefined);
}

export function parseCsvStatement(text: string, mapping: CsvMapping): ParsedStatement {
  const table = readCsvTable(text);
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];

  for (const row of table.rows) {
    const cell = (index: number | undefined) => (index === undefined ? "" : (row.cells[index] ?? ""));
    const rawDate = cell(mapping.date);
    const label = cleanLabel([cell(mapping.label), cell(mapping.labelExtra)].filter(Boolean).join(" — "));
    // Lignes de total, de solde ou vides en fin de fichier : ignorées sans signalement.
    if (!rawDate && !label) continue;
    if (!rawDate || /^(total|solde)/i.test(label) || /^(total|solde)/i.test(rawDate)) continue;

    const date = parseStatementDate(rawDate);
    if (!date) {
      issues.push({ line: row.line, message: `Date illisible : « ${rawDate.slice(0, 30)} »` });
      continue;
    }

    let amount: string | null = null;
    if (mapping.amount !== undefined && cell(mapping.amount)) {
      amount = parseAmount(cell(mapping.amount));
    } else {
      const debit = cell(mapping.debit) ? parseAmount(cell(mapping.debit)) : null;
      const credit = cell(mapping.credit) ? parseAmount(cell(mapping.credit)) : null;
      // Une colonne « Débit » contient un montant positif ou négatif selon les banques : c'est toujours un décaissement.
      if (debit && debit !== "0.00") amount = debit.startsWith("-") ? debit : `-${debit}`;
      else if (credit && credit !== "0.00") amount = credit.replace(/^-/, "");
    }
    if (!amount || amount === "0.00") {
      issues.push({ line: row.line, message: "Montant absent ou illisible" });
      continue;
    }
    if (!label) {
      issues.push({ line: row.line, message: "Libellé absent" });
      continue;
    }
    const valueDate = cell(mapping.valueDate) ? (parseStatementDate(cell(mapping.valueDate)) ?? undefined) : undefined;
    transactions.push({ date, valueDate, label, amount });
  }
  return { format: "CSV", transactions, issues };
}
