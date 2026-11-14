import { XMLParser } from "fast-xml-parser";
import { cleanLabel, parseAmount, parseStatementDate, StatementParseError, type ParsedStatement, type ParsedTransaction, type ParseIssue } from "./types";

/**
 * Relevés ISO 20022 camt.053. Les entités externes et les DTD ne sont jamais
 * résolues (aucun risque d'inclusion de fichiers ou de requêtes sortantes).
 */

type Node = Record<string, unknown>;

const asArray = <T,>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const text = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") return text((value as Node)["#text"]);
  const result = String(value).trim();
  return result || undefined;
};
const child = (node: unknown, ...path: string[]): unknown => path.reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Node)[key] : undefined), node);

export function parseCamtStatement(xml: string): ParsedStatement {
  let document: Node;
  try {
    document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml) as Node;
  } catch {
    throw new StatementParseError("Ce fichier XML est illisible.");
  }
  const statements = asArray(child(document, "Document", "BkToCstmrStmt", "Stmt") as Node | Node[] | undefined);
  if (statements.length === 0) throw new StatementParseError("Ce fichier n'est pas un relevé camt.053 valide.");

  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];
  let currency: string | undefined;
  let accountRef: string | undefined;
  let rank = 0;

  for (const statement of statements) {
    accountRef ??= text(child(statement, "Acct", "Id", "IBAN")) ?? text(child(statement, "Acct", "Id", "Othr", "Id"));
    currency ??= text(child(statement, "Acct", "Ccy"));
    for (const entry of asArray(child(statement, "Ntry") as Node | Node[] | undefined)) {
      rank++;
      const amountNode = child(entry, "Amt");
      const unsigned = parseAmount(text(amountNode) ?? "");
      const direction = text(child(entry, "CdtDbtInd"));
      const date = parseStatementDate(text(child(entry, "BookgDt", "Dt")) ?? text(child(entry, "BookgDt", "DtTm")) ?? "");
      if (!unsigned || !date || (direction !== "CRDT" && direction !== "DBIT")) {
        issues.push({ line: rank, message: "Écriture sans date, sans montant ou sans sens lisible" });
        continue;
      }
      if (unsigned === "0.00") continue;
      currency ??= text(child(amountNode, "@Ccy"));
      // Une écriture annulée (RvslInd) inverse le sens indiqué.
      const reversed = text(child(entry, "RvslInd")) === "true";
      const debit = (direction === "DBIT") !== reversed;
      const details = asArray(child(entry, "NtryDtls", "TxDtls") as Node | Node[] | undefined)[0];
      const remittance = asArray(child(details, "RmtInf", "Ustrd") as unknown[] | undefined).map(text).filter(Boolean).join(" ");
      const counterparty = text(child(details, "RltdPties", debit ? "Cdtr" : "Dbtr", "Nm")) ?? text(child(details, "RltdPties", debit ? "Cdtr" : "Dbtr", "Pty", "Nm"));
      const label = cleanLabel([counterparty, remittance || text(child(entry, "AddtlNtryInf"))].filter(Boolean).join(" — "));
      const valueDate = parseStatementDate(text(child(entry, "ValDt", "Dt")) ?? "") ?? undefined;
      transactions.push({
        date,
        valueDate,
        label: label || "Opération sans libellé",
        amount: debit ? `-${unsigned}` : unsigned,
        externalId: (text(child(entry, "AcctSvcrRef")) ?? text(child(entry, "NtryRef")))?.slice(0, 191),
      });
    }
  }
  return { format: "CAMT053", transactions, issues, currency, accountRef };
}
