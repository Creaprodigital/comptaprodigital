import { describe, expect, it } from "vitest";
import { analyzeStatement, detectStatementFormat, parseAmount, parseStatementDate, StatementParseError } from "@/server/modules/bank/parsers";
import { guessCsvMapping, parseCsvStatement, readCsvTable } from "@/server/modules/bank/parsers/csv";
import { fingerprintTransactions, normalizeLabel, ruleMatches } from "@/server/modules/bank/labels";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("montants et dates des relevés", () => {
  it("lit les montants dans les formats bancaires courants, sans flottant", () => {
    expect(parseAmount("1 234,56")).toBe("1234.56");
    expect(parseAmount("-1.234,56")).toBe("-1234.56");
    expect(parseAmount("1,234.56")).toBe("1234.56");
    expect(parseAmount("12,5-")).toBe("-12.50");
    expect(parseAmount("(45,00)")).toBe("-45.00");
    expect(parseAmount("+45.00 EUR")).toBe("45.00");
    expect(parseAmount("0,10")).toBe("0.10");
    expect(parseAmount("-0,00")).toBe("0.00");
    expect(parseAmount("12,345")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("=1+1")).toBeNull();
  });

  it("lit les dates jour/mois/année et ISO, refuse les dates impossibles", () => {
    expect(parseStatementDate("05/11/2026")).toBe("2026-11-05");
    expect(parseStatementDate("05.11.26")).toBe("2026-11-05");
    expect(parseStatementDate("2026-11-05")).toBe("2026-11-05");
    expect(parseStatementDate("20261105120000[+1:CET]")).toBe("2026-11-05");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("demain")).toBeNull();
  });
});

describe("relevés CSV", () => {
  const classic = [
    "Compte courant;FR76 •••• 0142",
    "Période du 01/11/2026 au 30/11/2026",
    "",
    "Date opération;Date valeur;Libellé;Débit;Crédit",
    "02/11/2026;02/11/2026;VIR SEPA MAISON VERDIER F-2026-0042;;5 712,00",
    '05/11/2026;05/11/2026;"PRLV SEPA OPERATEUR; MOBILE";115,20;',
    "07/11/2026;07/11/2026;CB PAPETERIE CENTRALE;-84,90;",
    "09/11/2026;09/11/2026;FRAIS TENUE DE COMPTE;18,50;",
    "Solde au 30/11/2026;;;;12 345,67",
  ].join("\r\n");

  it("détecte le séparateur, l'en-tête après un préambule et le rôle des colonnes", () => {
    const table = readCsvTable(classic);
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["Date opération", "Date valeur", "Libellé", "Débit", "Crédit"]);
    expect(guessCsvMapping(table)).toEqual({ date: 0, valueDate: 1, label: 2, debit: 3, credit: 4 });
  });

  it("convertit débits et crédits en montants signés et ignore la ligne de solde", () => {
    const result = parseCsvStatement(classic, { date: 0, valueDate: 1, label: 2, debit: 3, credit: 4 });
    expect(result.issues).toEqual([]);
    expect(result.transactions).toEqual([
      { date: "2026-11-02", valueDate: "2026-11-02", label: "VIR SEPA MAISON VERDIER F-2026-0042", amount: "5712.00" },
      { date: "2026-11-05", valueDate: "2026-11-05", label: "PRLV SEPA OPERATEUR; MOBILE", amount: "-115.20" },
      { date: "2026-11-07", valueDate: "2026-11-07", label: "CB PAPETERIE CENTRALE", amount: "-84.90" },
      { date: "2026-11-09", valueDate: "2026-11-09", label: "FRAIS TENUE DE COMPTE", amount: "-18.50" },
    ]);
  });

  it("gère un export à montant unique séparé par des virgules", () => {
    const csv = 'date,description,amount\n2026-11-02,"Payment, invoice 42",1200.00\n2026-11-03,Bank fee,-4.50\n';
    const preview = analyzeStatement(bytes(csv));
    expect(preview.format).toBe("CSV");
    expect(preview.csv?.mapping).toEqual({ date: 0, label: 1, amount: 2 });
    expect(preview.statement?.transactions).toEqual([
      { date: "2026-11-02", valueDate: undefined, label: "Payment, invoice 42", amount: "1200.00" },
      { date: "2026-11-03", valueDate: undefined, label: "Bank fee", amount: "-4.50" },
    ]);
  });

  it("devine les colonnes d'un fichier sans en-tête", () => {
    const csv = "02/11/2026;VIR CLIENT ALPHA;1 000,00\n03/11/2026;CB RESTAURANT;-35,40\n04/11/2026;PRLV LOYER;-950,00\n";
    const preview = analyzeStatement(bytes(csv));
    expect(preview.csv?.mapping).toEqual({ date: 0, label: 1, amount: 2 });
    expect(preview.statement?.transactions).toHaveLength(3);
  });

  it("signale les lignes illisibles avec leur numéro, sans bloquer les autres", () => {
    const csv = "Date;Libellé;Montant\n02/11/2026;OK;10,00\npas une date;KO;10,00\n03/11/2026;SANS MONTANT;\n04/11/2026;OK 2;-5,00\n";
    const result = parseCsvStatement(csv, { date: 0, label: 1, amount: 2 });
    expect(result.transactions.map((t) => t.label)).toEqual(["OK", "OK 2"]);
    expect(result.issues).toEqual([
      { line: 3, message: "Date illisible : « pas une date »" },
      { line: 4, message: "Montant absent ou illisible" },
    ]);
  });

  it("décode un fichier Windows-1252 et ne retourne qu'un aperçu si la correspondance est incomplète", () => {
    const latin1 = Uint8Array.from(Buffer.from("Date;Libellé;Montant\n02/11/2026;Café réglé;-3,50\n", "latin1"));
    expect(analyzeStatement(latin1).statement?.transactions[0].label).toBe("Café réglé");
    const ambiguous = analyzeStatement(bytes("A;B\nx;y\nz;w\n"));
    expect(ambiguous.statement).toBeNull();
    expect(ambiguous.csv?.headers).toEqual(["Colonne 1", "Colonne 2"]);
  });

  it("refuse un fichier vide ou une correspondance hors bornes", () => {
    expect(() => analyzeStatement(bytes("Date;Libellé;Montant\n"))).toThrow(StatementParseError);
    expect(() => analyzeStatement(bytes("Date;Libellé;Montant\n02/11/2026;X;1,00\n"), { date: 0, label: 1, amount: 9 })).toThrow(StatementParseError);
  });
});

describe("relevés OFX", () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>EUR
<BANKACCTFROM><BANKID>30004<ACCTID>00012345678<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261101<DTEND>20261130
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261102120000
<TRNAMT>5712.00
<FITID>2026110200001
<NAME>VIR MAISON VERDIER
<MEMO>F-2026-0042 &amp; solde
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-115,20<FITID>2026110500002<NAME>PRLV OPERATEUR</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>INCONNU<TRNAMT>-1.00<FITID>X</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

  it("lit les opérations d'un OFX en SGML, balises non fermées comprises", () => {
    expect(detectStatementFormat(ofx)).toBe("OFX");
    const result = analyzeStatement(bytes(ofx)).statement!;
    expect(result.currency).toBe("EUR");
    expect(result.accountRef).toBe("00012345678");
    expect(result.transactions).toEqual([
      { date: "2026-11-02", valueDate: undefined, label: "VIR MAISON VERDIER — F-2026-0042 & solde", amount: "5712.00", externalId: "2026110200001" },
      { date: "2026-11-05", valueDate: undefined, label: "PRLV OPERATEUR", amount: "-115.20", externalId: "2026110500002" },
    ]);
    expect(result.issues).toHaveLength(1);
  });
});

describe("relevés camt.053", () => {
  const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>FR7630006000011234567890189</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">5712.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-11-02</Dt></BookgDt><ValDt><Dt>2026-11-03</Dt></ValDt>
        <AcctSvcrRef>REF-0001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Nm>MAISON VERDIER</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>F-2026-0042</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">115.20</Amt><CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-11-05</Dt></BookgDt>
        <AcctSvcrRef>REF-0002</AcctSvcrRef>
        <AddtlNtryInf>PRLV SEPA OPERATEUR &amp; MOBILE</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RvslInd>true</RvslInd>
        <BookgDt><Dt>2026-11-06</Dt></BookgDt>
        <AddtlNtryInf>ANNULATION PRLV</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

  it("lit les écritures, leur sens, leur contrepartie et leur référence", () => {
    expect(detectStatementFormat(camt)).toBe("CAMT053");
    const result = analyzeStatement(bytes(camt)).statement!;
    expect(result.accountRef).toBe("FR7630006000011234567890189");
    expect(result.transactions).toEqual([
      { date: "2026-11-02", valueDate: "2026-11-03", label: "MAISON VERDIER — F-2026-0042", amount: "5712.00", externalId: "REF-0001" },
      { date: "2026-11-05", valueDate: undefined, label: "PRLV SEPA OPERATEUR & MOBILE", amount: "-115.20", externalId: "REF-0002" },
      { date: "2026-11-06", valueDate: undefined, label: "ANNULATION PRLV", amount: "50.00", externalId: undefined }, // extourne d'un débit
    ]);
  });

  it("ne résout pas les entités externes et refuse les XML étrangers", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt>1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-02</Dt></BookgDt><AddtlNtryInf>&x;</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;
    let label = "";
    try {
      label = analyzeStatement(bytes(xxe)).statement?.transactions[0]?.label ?? "";
    } catch {
      label = "";
    }
    expect(label).not.toContain("root:");
    expect(() => analyzeStatement(bytes("<?xml version='1.0'?><html><body/></html>"))).toThrow(StatementParseError);
  });
});

describe("doublons et règles de catégorisation", () => {
  it("normalise les libellés", () => {
    expect(normalizeLabel("  Prlv. SEPA — Opérateur/Télécom n°42 ")).toBe("PRLV SEPA OPERATEUR TELECOM N 42");
  });

  it("produit des empreintes stables, distinctes pour deux opérations identiques le même jour", () => {
    const transactions = [
      { date: "2026-11-02", label: "CB BOULANGERIE", amount: "-4.20" },
      { date: "2026-11-02", label: "CB Boulangerie", amount: "-4.20" },
      { date: "2026-11-03", label: "CB BOULANGERIE", amount: "-4.20" },
    ];
    const first = fingerprintTransactions(transactions);
    expect(new Set(first).size).toBe(3);
    expect(fingerprintTransactions(transactions)).toEqual(first); // réimport du même fichier
    expect(fingerprintTransactions(transactions.slice(0, 1))[0]).toBe(first[0]); // relevé qui recouvre la période
  });

  it("applique les règles selon le libellé, le sens et le montant", () => {
    const rule = { matchType: "CONTAINS" as const, pattern: "opérateur télécom", direction: "OUT", amountMin: null, amountMax: { toString: () => "200" } };
    expect(ruleMatches(rule, { label: "PRLV SEPA OPERATEUR TELECOM 11/26", amount: "-115.20" })).toBe(true);
    expect(ruleMatches(rule, { label: "PRLV SEPA OPERATEUR TELECOM 11/26", amount: "115.20" })).toBe(false); // sens
    expect(ruleMatches(rule, { label: "PRLV SEPA OPERATEUR TELECOM", amount: "-250.00" })).toBe(false); // plafond
    expect(ruleMatches({ ...rule, matchType: "STARTS_WITH", pattern: "prlv" }, { label: "Prlv Loyer", amount: "-1.00" })).toBe(true);
    expect(ruleMatches({ ...rule, matchType: "EQUALS", pattern: "prlv" }, { label: "Prlv Loyer", amount: "-1.00" })).toBe(false);
    expect(ruleMatches({ ...rule, matchType: "REGEX", pattern: "(a+)+$" }, { label: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!", amount: "-1.00" })).toBe(false); // jamais évaluée
  });
});
