import { XMLParser } from "fast-xml-parser";
import type { EInvoiceFormat } from "@prisma/client";
import { dec } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

/**
 * Lecture des données d'en-tête d'une facture électronique reçue : syntaxe CII (Factur-X, CII D16B)
 * ou UBL 2.1 (Invoice, CreditNote). Seules les informations nécessaires au classement et à la saisie
 * de l'achat sont extraites ; l'original est conservé tel quel. Les entités XML ne sont pas résolues.
 */

export type IncomingSummary = {
  number: string;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  creditNote: boolean;
  currency: string;
  sellerName: string;
  sellerSiren: string | null;
  sellerVatNumber: string | null;
  buyerSiren: string | null;
  /** Montants signés (négatifs pour un avoir). */
  totalExclTax: string;
  totalVat: string;
  totalInclTax: string;
};

export class EInvoiceParseError extends Error {}

type Node = Record<string, unknown>;
const MAX_XML_BYTES = 5 * 1024 * 1024;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, processEntities: false, trimValues: true });

const asArray = <T,>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const child = (node: unknown, ...path: string[]): unknown => path.reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Node)[key] : undefined), node);
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text((value as Node)["#text"]);
  const result = String(value).trim();
  return result || null;
}
const attr = (value: unknown, name: string): string | null => (value && typeof value === "object" && !Array.isArray(value) ? text((value as Node)[`@${name}`]) : null);

function required(value: string | null, label: string): string {
  if (!value) throw new EInvoiceParseError(`${label} absent de la facture`);
  return value;
}

function amount(value: string | null, label: string): string {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value)) throw new EInvoiceParseError(`${label} absent ou invalide`);
  return dec(value).toFixed(2);
}

function cceDate(value: string | null): IsoDate | null {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` as IsoDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value as IsoDate;
  throw new EInvoiceParseError(`Date invalide : ${value}`);
}

const siren = (value: string | null): string | null => {
  const digits = value?.replace(/\s/g, "") ?? "";
  return /^\d{9}$/.test(digits) ? digits : /^\d{14}$/.test(digits) ? digits.slice(0, 9) : null;
};

function signed(values: { totalExclTax: string; totalVat: string; totalInclTax: string }, creditNote: boolean) {
  if (!creditNote) return values;
  const neg = (v: string) => dec(v).abs().negated().toFixed(2);
  return { totalExclTax: neg(values.totalExclTax), totalVat: neg(values.totalVat), totalInclTax: neg(values.totalInclTax) };
}

/** Montant de TVA dans la devise de la facture (CII : plusieurs TaxTotalAmount possibles, BT-110 / BT-111). */
function taxTotal(nodes: unknown, currency: string): string | null {
  const list = asArray(nodes);
  const match = list.find((n) => attr(n, "currencyID") === currency) ?? list[0];
  return text(match);
}

function parseCii(root: Node): IncomingSummary {
  const doc = child(root, "ExchangedDocument");
  const transaction = child(root, "SupplyChainTradeTransaction");
  const agreement = child(transaction, "ApplicableHeaderTradeAgreement");
  const settlement = child(transaction, "ApplicableHeaderTradeSettlement");
  const seller = child(agreement, "SellerTradeParty");
  const buyer = child(agreement, "BuyerTradeParty");
  const totals = child(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const currency = required(text(child(settlement, "InvoiceCurrencyCode")), "Devise");
  const creditNote = ["381", "261", "262", "296", "308", "396", "420", "458", "532"].includes(text(child(doc, "TypeCode")) ?? "");
  const vat = asArray(child(seller, "SpecifiedTaxRegistration") as Node | Node[]).find((r) => attr(child(r, "ID"), "schemeID") === "VA");
  const due = asArray(child(settlement, "SpecifiedTradePaymentTerms") as Node | Node[])
    .map((t) => text(child(t, "DueDateDateTime", "DateTimeString")))
    .find(Boolean);
  return {
    number: required(text(child(doc, "ID")), "Numéro de facture"),
    issueDate: required(cceDate(text(child(doc, "IssueDateTime", "DateTimeString"))), "Date de facture") as IsoDate,
    dueDate: cceDate(due ?? null),
    creditNote,
    currency: currency.toUpperCase(),
    sellerName: required(text(child(seller, "Name")), "Nom du vendeur").slice(0, 191),
    sellerSiren: siren(text(child(seller, "SpecifiedLegalOrganization", "ID"))),
    sellerVatNumber: vat ? text(child(vat, "ID"))?.replace(/\s/g, "").toUpperCase().slice(0, 20) ?? null : null,
    buyerSiren: siren(text(child(buyer, "SpecifiedLegalOrganization", "ID"))),
    ...signed(
      {
        totalExclTax: amount(text(child(totals, "TaxBasisTotalAmount")), "Total hors taxes"),
        totalVat: amount(taxTotal(child(totals, "TaxTotalAmount"), currency) ?? "0", "Total de TVA"),
        totalInclTax: amount(text(child(totals, "GrandTotalAmount")), "Total toutes taxes comprises"),
      },
      creditNote,
    ),
  };
}

function parseUbl(root: Node, creditNote: boolean): IncomingSummary {
  const sellerParty = child(root, "AccountingSupplierParty", "Party");
  const buyerParty = child(root, "AccountingCustomerParty", "Party");
  const legal = child(sellerParty, "PartyLegalEntity");
  const totals = child(root, "LegalMonetaryTotal");
  const currency = required(text(child(root, "DocumentCurrencyCode")), "Devise").toUpperCase();
  const vat = asArray(child(sellerParty, "PartyTaxScheme") as Node | Node[]).map((s) => text(child(s, "CompanyID"))).find(Boolean) ?? null;
  const taxAmounts = asArray(child(root, "TaxTotal") as Node | Node[]).map((t) => child(t, "TaxAmount"));
  return {
    number: required(text(child(root, "ID")), "Numéro de facture"),
    issueDate: required(cceDate(text(child(root, "IssueDate"))), "Date de facture") as IsoDate,
    dueDate: cceDate(text(child(root, "DueDate")) ?? text(child(root, "PaymentMeans", "PaymentDueDate"))),
    creditNote,
    currency,
    sellerName: required(text(child(legal, "RegistrationName")) ?? text(child(sellerParty, "PartyName", "Name")), "Nom du vendeur").slice(0, 191),
    sellerSiren: siren(text(child(legal, "CompanyID"))),
    sellerVatNumber: vat?.replace(/\s/g, "").toUpperCase().slice(0, 20) ?? null,
    buyerSiren: siren(text(child(buyerParty, "PartyLegalEntity", "CompanyID"))),
    ...signed(
      {
        totalExclTax: amount(text(child(totals, "TaxExclusiveAmount")), "Total hors taxes"),
        totalVat: amount(taxTotal(taxAmounts, currency) ?? "0", "Total de TVA"),
        totalInclTax: amount(text(child(totals, "TaxInclusiveAmount")), "Total toutes taxes comprises"),
      },
      creditNote,
    ),
  };
}

export function parseIncomingInvoice(xml: string, format: EInvoiceFormat): IncomingSummary {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) throw new EInvoiceParseError("Fichier XML trop volumineux");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new EInvoiceParseError("Déclarations DTD refusées");
  let tree: Node;
  try {
    tree = parser.parse(xml) as Node;
  } catch {
    throw new EInvoiceParseError("XML illisible");
  }
  if (format === "UBL") {
    if (tree.Invoice) return parseUbl(tree.Invoice as Node, false);
    if (tree.CreditNote) return parseUbl(tree.CreditNote as Node, true);
    throw new EInvoiceParseError("Document UBL attendu (Invoice ou CreditNote)");
  }
  if (!tree.CrossIndustryInvoice) throw new EInvoiceParseError("Document CII attendu (CrossIndustryInvoice)");
  return parseCii(tree.CrossIndustryInvoice as Node);
}
