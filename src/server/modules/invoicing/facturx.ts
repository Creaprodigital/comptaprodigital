import Decimal from "decimal.js";
import type { Company } from "@prisma/client";
import { decryptSecret } from "@/server/security/crypto";
import { toIsoDate } from "@/lib/dates";
import { dec } from "@/lib/money";
import { FRANCHISE_VAT_MENTION, computeDocumentTotals } from "@/lib/invoicing";
import type { InvoiceWithDetail } from "@/server/modules/invoicing/invoices";
import { buildPartiesSnapshot, type PartiesSnapshot, type PartySnapshot } from "@/server/modules/invoicing/shared";

/**
 * Facture électronique Factur-X : XML « Cross Industry Invoice » (CII, UN/CEFACT D16B),
 * profil EN 16931 — la norme européenne de la facture électronique, retenue par la réforme
 * française. Le XML est incorporé au PDF/A-3 de la facture (voir pdf.ts).
 *
 * Avant toute incorporation, le XML est contrôlé (règles de cohérence de la norme : sommes des
 * lignes, bases et montants de TVA par taux, total TTC, reste à payer, champs obligatoires).
 * Une facture qui ne passe pas les contrôles est émise en PDF simple, et la raison est affichée :
 * jamais de Factur-X incohérent.
 */

export const FACTURX_GUIDELINE = "urn:cen.eu:en16931:2017";

const NS = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  qdt: "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
};

/** Code de type de document (UNTDID 1001). */
const TYPE_CODES = { INVOICE: "380", DEPOSIT: "386", CREDIT_NOTE: "381" } as const;

/** Unités usuelles → codes de la recommandation UN/ECE n° 20 (« C62 » = unité, par défaut). */
const UNIT_CODES: Array<[RegExp, string]> = [
  [/^(h|hr|hrs|heures?)$/, "HUR"],
  [/^(min|minutes?)$/, "MIN"],
  [/^(j|jours?|journ[ée]es?)$/, "DAY"],
  [/^(sem|semaines?)$/, "WEE"],
  [/^(mois)$/, "MON"],
  [/^(an|ans|ann[ée]es?)$/, "ANN"],
  [/^(kg|kilos?|kilogrammes?)$/, "KGM"],
  [/^(g|grammes?)$/, "GRM"],
  [/^(t|tonnes?)$/, "TNE"],
  [/^(l|litres?)$/, "LTR"],
  [/^(m|m[èe]tres?)$/, "MTR"],
  [/^(km|kilom[èe]tres?)$/, "KMT"],
  [/^(m2|m²|m[èe]tres? carr[ée]s?)$/, "MTK"],
  [/^(m3|m³|m[èe]tres? cubes?)$/, "MTQ"],
];

export function unitCode(unit: string | null | undefined): string {
  const normalized = (unit ?? "").trim().toLowerCase();
  return UNIT_CODES.find(([pattern]) => pattern.test(normalized))?.[1] ?? "C62";
}

const VATEX_FRANCHISE = "VATEX-FR-FRANCHISE";

type TaxCategory = { code: "S" | "E" | "Z"; rate: Decimal; exemptionReason?: string; exemptionCode?: string };

function taxCategory(rate: Decimal.Value, franchise: boolean): TaxCategory {
  if (franchise) return { code: "E", rate: dec(0), exemptionReason: FRANCHISE_VAT_MENTION, exemptionCode: VATEX_FRANCHISE };
  const value = dec(rate);
  return value.isZero() ? { code: "Z", rate: value } : { code: "S", rate: value };
}

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caractères de contrôle interdits en XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const amount = (value: Decimal.Value) => dec(value).toFixed(2);
/** Quantités et prix unitaires : jusqu'à 4 décimales, sans zéros inutiles. */
const precise = (value: Decimal.Value) => dec(value).toDecimalPlaces(4).toString();
const percent = (value: Decimal.Value) => dec(value).toDecimalPlaces(2).toString();
const date102 = (date: Date) => toIsoDate(date).replace(/-/g, "");

/** Données normalisées de la facture électronique (utilisées pour le XML et pour les contrôles). */
export type FacturXData = {
  typeCode: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  serviceDate: Date | null;
  currency: string;
  notes: Array<{ subject: "AAI" | "PMT" | "PMD" | "AAB" | "REG"; content: string }>;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  iban: string | null;
  bic: string | null;
  paymentTerms: string | null;
  precedingInvoice: string | null;
  vatOnDebits: boolean;
  lines: Array<{ id: string; name: string; quantity: Decimal; unitCode: string; netPrice: Decimal; allowance: Decimal; lineTotal: Decimal; category: TaxCategory }>;
  allowances: Array<{ amount: Decimal; category: TaxCategory; reason: string }>;
  taxes: Array<{ category: TaxCategory; basis: Decimal; amount: Decimal }>;
  totals: { lineTotal: Decimal; allowanceTotal: Decimal; taxBasis: Decimal; taxTotal: Decimal; grandTotal: Decimal; prepaid: Decimal; duePayable: Decimal };
};

/** Prépare les données EN 16931 d'une facture, d'un acompte ou d'un avoir émis. */
export function facturXData(company: Company, invoice: InvoiceWithDetail): FacturXData {
  if (!invoice.number || !invoice.issueDate) throw new Error("Seule une facture émise (numérotée et datée) a une version électronique.");
  const parties: PartiesSnapshot = invoice.partiesSnapshot ? (invoice.partiesSnapshot as PartiesSnapshot) : buildPartiesSnapshot(company, invoice.customer);
  const franchise = parties.seller.vatRegime === "FRANCHISE";
  const isCreditNote = invoice.type === "CREDIT_NOTE";

  const totals = computeDocumentTotals(
    invoice.items.map((item) => ({ quantity: item.quantity.toString(), unitPriceExclTax: item.unitPriceExclTax.toString(), discountRate: item.discountRate.toString(), vatRate: item.vatRate.toString() })),
    { type: invoice.discountType, value: invoice.discountValue.toString() },
  );

  const lines = invoice.items.map((item, index) => {
    // Règle BR-27 : le prix net ne peut pas être négatif. Une ligne de déduction (acompte déjà
    // facturé) s'exprime par une quantité négative et un prix positif — même total de ligne.
    const rawQuantity = dec(item.quantity.toString());
    const rawPrice = dec(item.unitPriceExclTax.toString());
    const quantity = rawPrice.isNegative() ? rawQuantity.negated() : rawQuantity;
    const netPrice = rawPrice.abs();
    const lineTotal = dec(item.totalExclTax.toString());
    // Remise de ligne : écart entre quantité × prix et total de la ligne (montant exact, arrondi au centime).
    const allowance = quantity.times(netPrice).toDecimalPlaces(2).minus(lineTotal);
    return { id: String(index + 1), name: item.description.split("\n")[0].slice(0, 500) || "Prestation", quantity, unitCode: unitCode(item.unit), netPrice, allowance, lineTotal, category: taxCategory(item.vatRate.toString(), franchise) };
  });

  // Remise globale : une remise de document par taux de TVA (répartition déjà calculée dans les bases).
  const allowances = totals.vatBreakdown
    .map((row) => {
      const linesAtRate = lines.filter((l) => l.category.rate.equals(franchise ? 0 : row.rate)).reduce((acc, l) => acc.plus(l.lineTotal), dec(0));
      return { amount: linesAtRate.minus(row.base), category: taxCategory(row.rate, franchise), reason: "Remise" };
    })
    .filter((a) => !a.amount.isZero());

  const taxes = totals.vatBreakdown.map((row) => ({ category: taxCategory(row.rate, franchise), basis: row.base, amount: row.vat }));
  const allowanceTotal = allowances.reduce((acc, a) => acc.plus(a.amount), dec(0));

  const notes: FacturXData["notes"] = [];
  if (invoice.subject) notes.push({ subject: "AAI", content: invoice.subject });
  if (invoice.notes) notes.push({ subject: "AAI", content: invoice.notes });
  if (franchise) notes.push({ subject: "AAB", content: FRANCHISE_VAT_MENTION });
  if (!isCreditNote) {
    notes.push({
      subject: "PMT",
      content: parties.terms.latePenaltyRate
        ? `En cas de retard de paiement, pénalités au taux annuel de ${parties.terms.latePenaltyRate.replace(".", ",")} %.`
        : "En cas de retard de paiement, pénalités au taux de trois fois le taux d'intérêt légal.",
    });
    if (parties.buyer.type === "COMPANY") notes.push({ subject: "PMD", content: "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €." });
    notes.push({ subject: "AAB", content: parties.terms.earlyPaymentDiscountNote ?? "Pas d'escompte pour paiement anticipé." });
  }
  // Mentions légales de l'émetteur (forme, capital, RCS).
  const legal = [parties.seller.legalForm && parties.seller.shareCapital ? `${parties.seller.legalForm} au capital de ${parties.seller.shareCapital} €` : parties.seller.legalForm, parties.seller.rcsCity ? `RCS ${parties.seller.rcsCity}` : null].filter(Boolean);
  if (legal.length) notes.push({ subject: "REG", content: legal.join(" — ") });

  const grandTotal = dec(totals.totalInclTax);
  return {
    typeCode: TYPE_CODES[invoice.type],
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: isCreditNote ? null : invoice.dueDate,
    serviceDate: invoice.serviceDate,
    currency: invoice.currency,
    notes,
    seller: parties.seller,
    buyer: parties.buyer,
    iban: !isCreditNote && parties.seller.ibanEncrypted ? decryptSecret(parties.seller.ibanEncrypted).replace(/\s/g, "") : null,
    bic: parties.seller.bic ?? null,
    // Avoir : aucune échéance, mais des conditions (règle BR-CO-25 dès qu'un montant est dû).
    paymentTerms: invoice.paymentTerms ?? (isCreditNote ? `Avoir à imputer sur la facture ${invoice.originalInvoice?.number ?? "d'origine"} ou à rembourser.` : null),
    precedingInvoice: isCreditNote ? (invoice.originalInvoice?.number ?? null) : null,
    vatOnDebits: !franchise && invoice.vatExigibility === "DEBITS" && invoice.operationCategory !== "GOODS",
    lines,
    allowances,
    taxes,
    totals: {
      lineTotal: totals.subtotalExclTax,
      allowanceTotal,
      taxBasis: totals.totalExclTax,
      taxTotal: totals.totalVat,
      grandTotal,
      prepaid: dec(0),
      duePayable: grandTotal,
    },
  };
}

/**
 * Contrôles de la norme EN 16931 applicables à nos factures (règles BR-xx, BR-CO-xx, BR-S-xx…).
 * Retourne la liste des anomalies, vide si la facture électronique est conforme.
 */
export function checkFacturX(data: FacturXData): string[] {
  const problems: string[] = [];
  const sum = (values: Decimal[]) => values.reduce((acc, v) => acc.plus(v), dec(0));
  // Champs obligatoires.
  if (!data.number) problems.push("BR-02 : numéro de facture manquant");
  if (!data.seller.name) problems.push("BR-06 : nom du vendeur manquant");
  if (!data.buyer.name) problems.push("BR-07 : nom de l'acheteur manquant");
  if (!data.seller.country) problems.push("BR-09 : pays du vendeur manquant");
  if (!data.buyer.country) problems.push("BR-11 : pays de l'acheteur manquant");
  if (data.lines.length === 0) problems.push("BR-16 : la facture doit comporter au moins une ligne");
  if (data.typeCode === TYPE_CODES.CREDIT_NOTE && !data.precedingInvoice) problems.push("Avoir : la facture d'origine doit être référencée");
  // Identifiants requis selon la catégorie de TVA.
  const categories = new Set([...data.lines.map((l) => l.category.code)]);
  if ((categories.has("S") || categories.has("Z")) && !data.seller.vatNumber) {
    problems.push("BR-S-02 : le numéro de TVA intracommunautaire du vendeur est obligatoire (Paramètres de l'entreprise)");
  }
  if (categories.has("E") && !data.seller.vatNumber && !data.seller.siren) problems.push("BR-E-02 : SIREN ou numéro de TVA du vendeur obligatoire (Paramètres de l'entreprise)");
  // Cohérence des montants.
  const lineTotal = sum(data.lines.map((l) => l.lineTotal));
  if (!lineTotal.equals(data.totals.lineTotal)) problems.push(`BR-CO-10 : somme des lignes (${amount(lineTotal)}) ≠ total des lignes (${amount(data.totals.lineTotal)})`);
  const allowanceTotal = sum(data.allowances.map((a) => a.amount));
  if (!allowanceTotal.equals(data.totals.allowanceTotal)) problems.push("BR-CO-11 : somme des remises incohérente");
  if (!data.totals.lineTotal.minus(data.totals.allowanceTotal).equals(data.totals.taxBasis)) problems.push("BR-CO-13 : total HT ≠ lignes − remises");
  if (!sum(data.taxes.map((t) => t.amount)).equals(data.totals.taxTotal)) problems.push("BR-CO-14 : total de TVA ≠ somme des TVA par taux");
  if (!data.totals.taxBasis.plus(data.totals.taxTotal).equals(data.totals.grandTotal)) problems.push("BR-CO-15 : total TTC ≠ total HT + TVA");
  if (!data.totals.grandTotal.minus(data.totals.prepaid).equals(data.totals.duePayable)) problems.push("BR-CO-16 : reste à payer incohérent");
  for (const tax of data.taxes) {
    const linesBase = sum(data.lines.filter((l) => l.category.code === tax.category.code && l.category.rate.equals(tax.category.rate)).map((l) => l.lineTotal));
    const allowances = sum(data.allowances.filter((a) => a.category.code === tax.category.code && a.category.rate.equals(tax.category.rate)).map((a) => a.amount));
    if (!linesBase.minus(allowances).equals(tax.basis)) problems.push(`BR-${tax.category.code}-08 : base de TVA à ${percent(tax.category.rate)} % incohérente`);
    if (tax.category.code === "S" && !tax.basis.times(tax.category.rate).dividedBy(100).toDecimalPlaces(2).equals(tax.amount)) problems.push(`BR-S-09 : TVA à ${percent(tax.category.rate)} % mal calculée`);
    if (tax.category.code !== "S" && !tax.amount.isZero()) problems.push(`BR-${tax.category.code}-09 : la TVA doit être nulle`);
  }
  // Paiement : échéance ou conditions dès qu'un montant reste dû.
  if (data.totals.duePayable.greaterThan(0) && !data.dueDate && !data.paymentTerms) problems.push("BR-CO-25 : échéance ou conditions de paiement obligatoires");
  if (data.currency !== "EUR") problems.push("Seules les factures en euros sont produites au format électronique");
  return problems;
}

function party(tag: "SellerTradeParty" | "BuyerTradeParty", p: PartySnapshot, options: { fiscalIdentifier?: boolean } = {}): string {
  const address = [
    p.postalCode ? `<ram:PostcodeCode>${escape(p.postalCode)}</ram:PostcodeCode>` : "",
    p.addressLine1 ? `<ram:LineOne>${escape(p.addressLine1)}</ram:LineOne>` : "",
    p.addressLine2 ? `<ram:LineTwo>${escape(p.addressLine2)}</ram:LineTwo>` : "",
    p.city ? `<ram:CityName>${escape(p.city)}</ram:CityName>` : "",
    `<ram:CountryID>${escape(p.country ?? "FR")}</ram:CountryID>`,
  ].join("");
  return [
    `<ram:${tag}>`,
    `<ram:Name>${escape(p.name)}</ram:Name>`,
    // Identifiant légal : SIRET (schéma 0009) ou, à défaut, SIREN (0002).
    p.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0009">${escape(p.siret)}</ram:ID></ram:SpecifiedLegalOrganization>` : p.siren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${escape(p.siren)}</ram:ID></ram:SpecifiedLegalOrganization>` : "",
    `<ram:PostalTradeAddress>${address}</ram:PostalTradeAddress>`,
    p.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${escape(p.email)}</ram:URIID></ram:URIUniversalCommunication>` : "",
    p.vatNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escape(p.vatNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : "",
    // Vendeur en franchise de TVA, sans numéro de TVA : identifiant fiscal (BT-32, schéma « FC ») = SIREN.
    // Un vendeur redevable de la TVA doit, lui, porter son numéro de TVA intracommunautaire (CGI, art. 242 nonies A).
    options.fiscalIdentifier && !p.vatNumber && p.siren ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${escape(p.siren)}</ram:ID></ram:SpecifiedTaxRegistration>` : "",
    `</ram:${tag}>`,
  ].join("");
}

function tradeTax(category: TaxCategory, extra: { calculated?: Decimal; basis?: Decimal; dueDateTypeCode?: string } = {}): string {
  return [
    "<ram:ApplicableTradeTax>",
    extra.calculated !== undefined ? `<ram:CalculatedAmount>${amount(extra.calculated)}</ram:CalculatedAmount>` : "",
    "<ram:TypeCode>VAT</ram:TypeCode>",
    category.exemptionReason && extra.basis !== undefined ? `<ram:ExemptionReason>${escape(category.exemptionReason)}</ram:ExemptionReason>` : "",
    extra.basis !== undefined ? `<ram:BasisAmount>${amount(extra.basis)}</ram:BasisAmount>` : "",
    `<ram:CategoryCode>${category.code}</ram:CategoryCode>`,
    category.exemptionCode && extra.basis !== undefined ? `<ram:ExemptionReasonCode>${category.exemptionCode}</ram:ExemptionReasonCode>` : "",
    extra.dueDateTypeCode ? `<ram:DueDateTypeCode>${extra.dueDateTypeCode}</ram:DueDateTypeCode>` : "",
    `<ram:RateApplicablePercent>${percent(category.rate)}</ram:RateApplicablePercent>`,
    "</ram:ApplicableTradeTax>",
  ].join("");
}

/** Sérialise les données au format CII (ordre des éléments imposé par le schéma XSD). */
export function facturXml(data: FacturXData): string {
  const lines = data.lines
    .map((l) =>
      [
        "<ram:IncludedSupplyChainTradeLineItem>",
        `<ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>`,
        `<ram:SpecifiedTradeProduct><ram:Name>${escape(l.name)}</ram:Name></ram:SpecifiedTradeProduct>`,
        `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${precise(l.netPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`,
        `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${l.unitCode}">${precise(l.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`,
        "<ram:SpecifiedLineTradeSettlement>",
        tradeTax(l.category),
        l.allowance.isZero()
          ? ""
          : `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${amount(l.allowance)}</ram:ActualAmount><ram:Reason>Remise</ram:Reason></ram:SpecifiedTradeAllowanceCharge>`,
        `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(l.lineTotal)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>`,
        "</ram:SpecifiedLineTradeSettlement>",
        "</ram:IncludedSupplyChainTradeLineItem>",
      ].join(""),
    )
    .join("");

  const t = data.totals;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:qdt="${NS.qdt}" xmlns:udt="${NS.udt}">`,
    `<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FACTURX_GUIDELINE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>`,
    "<rsm:ExchangedDocument>",
    `<ram:ID>${escape(data.number)}</ram:ID>`,
    `<ram:TypeCode>${data.typeCode}</ram:TypeCode>`,
    `<ram:IssueDateTime><udt:DateTimeString format="102">${date102(data.issueDate)}</udt:DateTimeString></ram:IssueDateTime>`,
    ...data.notes.map((n) => `<ram:IncludedNote><ram:Content>${escape(n.content)}</ram:Content><ram:SubjectCode>${n.subject}</ram:SubjectCode></ram:IncludedNote>`),
    "</rsm:ExchangedDocument>",
    "<rsm:SupplyChainTradeTransaction>",
    lines,
    "<ram:ApplicableHeaderTradeAgreement>",
    party("SellerTradeParty", data.seller, { fiscalIdentifier: data.lines.every((l) => l.category.code === "E") }),
    party("BuyerTradeParty", data.buyer),
    "</ram:ApplicableHeaderTradeAgreement>",
    "<ram:ApplicableHeaderTradeDelivery>",
    data.serviceDate ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(data.serviceDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : "",
    "</ram:ApplicableHeaderTradeDelivery>",
    "<ram:ApplicableHeaderTradeSettlement>",
    `<ram:PaymentReference>${escape(data.number)}</ram:PaymentReference>`,
    `<ram:InvoiceCurrencyCode>${data.currency}</ram:InvoiceCurrencyCode>`,
    data.iban
      ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${escape(data.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${data.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${escape(data.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ""}</ram:SpecifiedTradeSettlementPaymentMeans>`
      : "",
    // TVA d'après les débits : exigible à la date de facture (code 5).
    ...data.taxes.map((tax) => tradeTax(tax.category, { calculated: tax.amount, basis: tax.basis, dueDateTypeCode: data.vatOnDebits && tax.category.code === "S" ? "5" : undefined })),
    ...data.allowances.map(
      (a) =>
        `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${amount(a.amount)}</ram:ActualAmount><ram:Reason>${escape(a.reason)}</ram:Reason><ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${a.category.code}</ram:CategoryCode><ram:RateApplicablePercent>${percent(a.category.rate)}</ram:RateApplicablePercent></ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`,
    ),
    data.dueDate || data.paymentTerms
      ? `<ram:SpecifiedTradePaymentTerms>${data.paymentTerms ? `<ram:Description>${escape(data.paymentTerms)}</ram:Description>` : ""}${data.dueDate ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${date102(data.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>` : ""}</ram:SpecifiedTradePaymentTerms>`
      : "",
    "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>",
    `<ram:LineTotalAmount>${amount(t.lineTotal)}</ram:LineTotalAmount>`,
    t.allowanceTotal.isZero() ? "" : `<ram:AllowanceTotalAmount>${amount(t.allowanceTotal)}</ram:AllowanceTotalAmount>`,
    `<ram:TaxBasisTotalAmount>${amount(t.taxBasis)}</ram:TaxBasisTotalAmount>`,
    `<ram:TaxTotalAmount currencyID="${data.currency}">${amount(t.taxTotal)}</ram:TaxTotalAmount>`,
    `<ram:GrandTotalAmount>${amount(t.grandTotal)}</ram:GrandTotalAmount>`,
    t.prepaid.isZero() ? "" : `<ram:TotalPrepaidAmount>${amount(t.prepaid)}</ram:TotalPrepaidAmount>`,
    `<ram:DuePayableAmount>${amount(t.duePayable)}</ram:DuePayableAmount>`,
    "</ram:SpecifiedTradeSettlementHeaderMonetarySummation>",
    data.precedingInvoice ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${escape(data.precedingInvoice)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : "",
    "</ram:ApplicableHeaderTradeSettlement>",
    "</rsm:SupplyChainTradeTransaction>",
    "</rsm:CrossIndustryInvoice>",
  ].join("\n");
}

export type FacturXResult = { xml: string; problems: string[] };

/** XML et contrôles d'une facture émise. */
export function buildFacturX(company: Company, invoice: InvoiceWithDetail): FacturXResult {
  const data = facturXData(company, invoice);
  return { xml: facturXml(data), problems: checkFacturX(data) };
}
