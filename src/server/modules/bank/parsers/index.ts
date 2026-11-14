import { guessCsvMapping, isCompleteMapping, parseCsvStatement, readCsvTable, type CsvMapping } from "./csv";
import { parseCamtStatement } from "./camt";
import { parseOfxStatement } from "./ofx";
import { decodeStatement, StatementParseError, type ParsedStatement, type StatementFormat } from "./types";

export * from "./types";
export type { CsvMapping } from "./csv";

/** Reconnaît le format d'un relevé à son contenu (l'extension du fichier n'est qu'un indice). */
export function detectStatementFormat(text: string): StatementFormat {
  const head = text.slice(0, 4000);
  if (/<OFX>|OFXHEADER/i.test(head)) return "OFX";
  if (/<(\w+:)?Document[\s>]/.test(head) && /camt\.05[234]|BkToCstmrStmt/.test(head)) return "CAMT053";
  if (/^\s*<\?xml|^\s*</.test(head)) throw new StatementParseError("Format XML non reconnu : seuls les relevés camt.053 sont pris en charge.");
  return "CSV";
}

export type StatementPreview = {
  format: StatementFormat;
  /** CSV uniquement : colonnes détectées et correspondance proposée, à confirmer par l'utilisateur. */
  csv?: { headers: string[]; mapping: Partial<CsvMapping>; sampleRows: string[][] };
  statement: ParsedStatement | null;
};

/** Analyse un relevé. Pour un CSV sans correspondance complète, seul l'aperçu des colonnes est retourné. */
export function analyzeStatement(buffer: Uint8Array, csvMapping?: CsvMapping): StatementPreview {
  const text = decodeStatement(buffer);
  const format = detectStatementFormat(text);
  if (format === "OFX") return { format, statement: parseOfxStatement(text) };
  if (format === "CAMT053") return { format, statement: parseCamtStatement(text) };

  const table = readCsvTable(text);
  const mapping = csvMapping ?? guessCsvMapping(table);
  const csv = { headers: table.headers, mapping, sampleRows: table.rows.slice(0, 8).map((row) => table.headers.map((_, i) => row.cells[i] ?? "")) };
  for (const index of Object.values(mapping)) {
    if (typeof index === "number" && (index < 0 || index >= table.headers.length)) throw new StatementParseError("La correspondance des colonnes ne correspond pas à ce fichier.");
  }
  return { format, csv, statement: isCompleteMapping(mapping) ? parseCsvStatement(text, mapping) : null };
}
