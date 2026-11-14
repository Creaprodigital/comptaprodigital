import type { Company, Customer } from "@prisma/client";
import { prisma } from "@/server/db";
import type { CompanyAccess } from "@/server/rbac/service";
import { decryptSecret } from "@/server/security/crypto";
import { formatIsoForHumans, toIsoDate } from "@/lib/dates";
import { dec } from "@/lib/money";
import { FRANCHISE_VAT_MENTION, INVOICE_TYPE_LABELS, OPERATION_CATEGORY_LABELS, computeDocumentTotals, remainingAmount } from "@/lib/invoicing";
import type { InvoiceWithDetail } from "@/server/modules/invoicing/invoices";
import type { QuoteWithDetail } from "@/server/modules/invoicing/quotes";
import { buildPartiesSnapshot, type PartiesSnapshot, type PartySnapshot } from "@/server/modules/invoicing/shared";

/**
 * Représentation structurée d'un devis ou d'une facture, indépendante du format
 * de sortie. Le PDF en est aujourd'hui le seul rendu ; les formats structurés de
 * la facturation électronique (Factur-X, UBL, CII) se brancheront sur ce même
 * modèle. Un PDF seul ne répond pas à l'obligation de facturation électronique.
 */
export type PrintableDocument = {
  kind: "QUOTE" | "INVOICE" | "DEPOSIT" | "CREDIT_NOTE";
  title: string;
  number: string | null;
  draft: boolean;
  currency: string;
  dates: Array<{ label: string; value: string }>;
  subject: string | null;
  notes: string | null;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  lines: Array<{ description: string; quantity: string; unit: string | null; unitPriceExclTax: string; discountRate: string; vatRate: string; totalExclTax: string }>;
  totals: {
    subtotalExclTax: string;
    discountAmount: string;
    totalExclTax: string;
    vatBreakdown: Array<{ rate: string; base: string; vat: string }>;
    totalVat: string;
    totalInclTax: string;
    amountPaid?: string;
    creditedAmount?: string;
    remaining?: string;
  };
  payment: Array<{ label: string; value: string }>;
  mentions: string[];
  footer: string;
  accentColor: string;
  logo: { mimeType: string; data: Buffer } | null;
  /** Zone « Bon pour accord » (devis). */
  signatureBlock: boolean;
};

function footerLine(seller: PartySnapshot): string {
  const parts = [
    seller.name,
    seller.legalForm && seller.shareCapital ? `${seller.legalForm} au capital de ${Number(seller.shareCapital).toLocaleString("fr-FR")} €` : seller.legalForm,
    seller.siret ? `SIRET ${seller.siret}` : seller.siren ? `SIREN ${seller.siren}` : null,
    seller.rcsCity ? `RCS ${seller.rcsCity}` : null,
    seller.vatNumber ? `TVA ${seller.vatNumber}` : null,
  ];
  return parts.filter(Boolean).join(" — ");
}

function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

async function loadLogo(companyId: string): Promise<PrintableDocument["logo"]> {
  const logo = await prisma.companyLogo.findUnique({ where: { companyId } });
  return logo ? { mimeType: logo.mimeType, data: Buffer.from(logo.data) } : null;
}

function linesAndTotals(
  items: Array<{ description: string; quantity: { toString(): string }; unit: string | null; unitPriceExclTax: { toString(): string }; discountRate: { toString(): string }; vatRate: { toString(): string }; totalExclTax: { toFixed(n: number): string } }>,
  discount: { type: "NONE" | "PERCENT" | "AMOUNT"; value: string },
) {
  const totals = computeDocumentTotals(
    items.map((item) => ({ quantity: item.quantity.toString(), unitPriceExclTax: item.unitPriceExclTax.toString(), discountRate: item.discountRate.toString(), vatRate: item.vatRate.toString() })),
    discount,
  );
  return {
    lines: items.map((item) => ({
      description: item.description,
      quantity: dec(item.quantity.toString()).toString(),
      unit: item.unit,
      unitPriceExclTax: dec(item.unitPriceExclTax.toString()).toString(),
      discountRate: dec(item.discountRate.toString()).toString(),
      vatRate: dec(item.vatRate.toString()).toString(),
      totalExclTax: item.totalExclTax.toFixed(2),
    })),
    totals: {
      subtotalExclTax: totals.subtotalExclTax.toFixed(2),
      discountAmount: totals.discountAmount.toFixed(2),
      totalExclTax: totals.totalExclTax.toFixed(2),
      vatBreakdown: totals.vatBreakdown.map((row) => ({ rate: row.rate.toString(), base: row.base.toFixed(2), vat: row.vat.toFixed(2) })),
      totalVat: totals.totalVat.toFixed(2),
      totalInclTax: totals.totalInclTax.toFixed(2),
    },
  };
}

function resolveParties(company: Company, customer: Customer, snapshot: unknown): PartiesSnapshot {
  // Une facture émise s'imprime avec les parties figées à l'émission, pas avec les fiches actuelles.
  return snapshot ? (snapshot as PartiesSnapshot) : buildPartiesSnapshot(company, customer);
}

export async function buildInvoiceDocument(access: CompanyAccess, invoice: InvoiceWithDetail): Promise<PrintableDocument> {
  const company = access.company;
  const parties = resolveParties(company, invoice.customer, invoice.partiesSnapshot);
  const { lines, totals } = linesAndTotals(invoice.items, { type: invoice.discountType, value: invoice.discountValue.toString() });
  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const draft = invoice.status === "DRAFT";
  const franchise = parties.seller.vatRegime === "FRANCHISE";

  const dates = [{ label: "Date d'émission", value: invoice.issueDate ? formatIsoForHumans(toIsoDate(invoice.issueDate)) : "—" }];
  if (invoice.serviceDate) dates.push({ label: "Date de la prestation", value: formatIsoForHumans(toIsoDate(invoice.serviceDate)) });
  if (invoice.dueDate && !isCreditNote) dates.push({ label: "Échéance", value: formatIsoForHumans(toIsoDate(invoice.dueDate)) });

  const payment: PrintableDocument["payment"] = [];
  if (!isCreditNote) {
    if (invoice.dueDate) payment.push({ label: "À régler avant le", value: formatIsoForHumans(toIsoDate(invoice.dueDate)) });
    if (invoice.paymentTerms) payment.push({ label: "Conditions", value: invoice.paymentTerms });
    if (parties.seller.ibanEncrypted) {
      payment.push({ label: "IBAN", value: formatIban(decryptSecret(parties.seller.ibanEncrypted)) });
      if (parties.seller.bic) payment.push({ label: "BIC", value: parties.seller.bic });
    }
    if (invoice.number) payment.push({ label: "Référence à rappeler", value: invoice.number });
  }

  const mentions: string[] = [];
  if (isCreditNote && invoice.originalInvoice?.number) mentions.push(`Avoir relatif à la facture ${invoice.originalInvoice.number}.`);
  mentions.push(`Nature de l'opération : ${OPERATION_CATEGORY_LABELS[invoice.operationCategory].toLowerCase()}.`);
  if (franchise) mentions.push(`${FRANCHISE_VAT_MENTION}.`);
  else if (invoice.vatExigibility === "DEBITS" && invoice.operationCategory !== "GOODS") mentions.push("Option pour le paiement de la taxe d'après les débits.");
  if (!isCreditNote) {
    mentions.push(
      parties.terms.latePenaltyRate
        ? `En cas de retard de paiement, des pénalités sont exigibles au taux annuel de ${parties.terms.latePenaltyRate.replace(".", ",")} %.`
        : "En cas de retard de paiement, des pénalités sont exigibles au taux de trois fois le taux d'intérêt légal.",
    );
    if (parties.buyer.type === "COMPANY") mentions.push("Indemnité forfaitaire pour frais de recouvrement due en cas de retard de paiement : 40 €.");
    mentions.push(parties.terms.earlyPaymentDiscountNote ?? "Pas d'escompte pour paiement anticipé.");
  }
  if (parties.terms.footer) mentions.push(parties.terms.footer);

  const settled = !draft && !isCreditNote && (dec(invoice.amountPaid).greaterThan(0) || dec(invoice.creditedAmount).greaterThan(0));
  return {
    kind: invoice.type,
    title: INVOICE_TYPE_LABELS[invoice.type],
    number: invoice.number,
    draft,
    currency: invoice.currency,
    dates,
    subject: invoice.subject,
    notes: invoice.notes,
    seller: parties.seller,
    buyer: parties.buyer,
    lines,
    totals: settled
      ? { ...totals, amountPaid: invoice.amountPaid.toFixed(2), creditedAmount: invoice.creditedAmount.toFixed(2), remaining: remainingAmount(invoice).toFixed(2) }
      : totals,
    payment,
    mentions,
    footer: footerLine(parties.seller),
    accentColor: company.invoiceAccentColor,
    logo: await loadLogo(company.id),
    signatureBlock: false,
  };
}

export async function buildQuoteDocument(access: CompanyAccess, quote: QuoteWithDetail): Promise<PrintableDocument> {
  const company = access.company;
  const parties = buildPartiesSnapshot(company, quote.customer);
  const { lines, totals } = linesAndTotals(quote.items, { type: quote.discountType, value: quote.discountValue.toString() });

  const dates = [{ label: "Date du devis", value: formatIsoForHumans(toIsoDate(quote.issueDate)) }];
  if (quote.validUntil) dates.push({ label: "Valable jusqu'au", value: formatIsoForHumans(toIsoDate(quote.validUntil)) });

  const mentions: string[] = [];
  if (company.vatRegime === "FRANCHISE") mentions.push(`${FRANCHISE_VAT_MENTION}.`);
  if (quote.terms) mentions.push(quote.terms);
  if (company.invoiceFooter) mentions.push(company.invoiceFooter);

  return {
    kind: "QUOTE",
    title: "Devis",
    number: quote.number,
    draft: quote.status === "DRAFT",
    currency: quote.currency,
    dates,
    subject: quote.subject,
    notes: quote.notes,
    seller: parties.seller,
    buyer: parties.buyer,
    lines,
    totals,
    payment: [],
    mentions,
    footer: footerLine(parties.seller),
    accentColor: company.invoiceAccentColor,
    logo: await loadLogo(company.id),
    signatureBlock: true,
  };
}
