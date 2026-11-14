import { cleanLabel, parseAmount, parseStatementDate, StatementParseError, type ParsedStatement, type ParsedTransaction, type ParseIssue } from "./types";

/**
 * Relevés OFX (1.x en SGML, 2.x en XML). Les balises feuilles du SGML ne sont
 * pas toujours fermées : la valeur est lue jusqu'à la balise ou la fin de ligne suivante.
 */

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  const value = match?.[1].trim();
  return value ? decodeEntities(value) : undefined;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function parseOfxStatement(text: string): ParsedStatement {
  if (!/<OFX>/i.test(text)) throw new StatementParseError("Ce fichier n'est pas un relevé OFX valide.");
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((part) => part.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];

  blocks.forEach((block, index) => {
    const date = parseStatementDate(tag(block, "DTPOSTED") ?? "");
    const amount = parseAmount(tag(block, "TRNAMT") ?? "");
    const name = tag(block, "NAME");
    const memo = tag(block, "MEMO");
    const label = cleanLabel([name, memo && memo !== name ? memo : undefined].filter(Boolean).join(" — "));
    if (!date || !amount) {
      issues.push({ line: index + 1, message: "Opération sans date ou sans montant lisible" });
      return;
    }
    if (amount === "0.00") return;
    const valueDate = tag(block, "DTAVAIL") ? (parseStatementDate(tag(block, "DTAVAIL")!) ?? undefined) : undefined;
    transactions.push({ date, valueDate, label: label || "Opération sans libellé", amount, externalId: tag(block, "FITID")?.slice(0, 191) });
  });

  return { format: "OFX", transactions, issues, currency: tag(text, "CURDEF"), accountRef: tag(text, "ACCTID") };
}
