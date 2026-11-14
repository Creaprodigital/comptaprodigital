import type { Prisma, Quote, QuoteStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { companyHasModule } from "@/server/modules/plans/service";
import { addDays, formatIsoForHumans, fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { dec, roundMoney } from "@/lib/money";
import { QUOTE_STATUS_LABELS, computeDocumentTotals, formatDocumentNumber } from "@/lib/invoicing";
import type { DocumentLineInput, QuoteInput } from "@/lib/schemas/invoicing";
import { createInvoiceDraft, type InvoiceWithDetail } from "@/server/modules/invoicing/invoices";
import {
  documentHistory,
  prepareDocumentLines,
  resolveActiveCustomer,
  serializeItem,
  takeNextNumber,
  totalsData,
  withTransactionRetry,
  type HistoryEntry,
  type ItemView,
  type Meta,
} from "@/server/modules/invoicing/shared";

const detailInclude = {
  items: { orderBy: { position: "asc" } },
  customer: true,
  invoices: { select: { id: true, number: true, type: true, status: true, totalInclTax: true } },
} satisfies Prisma.QuoteInclude;

export type QuoteWithDetail = Prisma.QuoteGetPayload<{ include: typeof detailInclude }>;

export type QuoteListItem = {
  id: string;
  number: string;
  status: QuoteStatus;
  customerId: string;
  customerName: string;
  subject: string | null;
  issueDate: string;
  validUntil: string | null;
  totalExclTax: string;
  totalInclTax: string;
};

export type QuoteView = QuoteListItem & {
  notes: string | null;
  terms: string | null;
  discountType: Quote["discountType"];
  discountValue: string;
  discountAmount: string;
  subtotalExclTax: string;
  totalVat: string;
  vatBreakdown: Array<{ rate: string; base: string; vat: string }>;
  customerEmail: string | null;
  items: ItemView[];
  invoices: Array<{ id: string; number: string | null; type: string; status: string; totalInclTax: string }>;
  sentAt: string | null;
  acceptedAt: string | null;
};

/** Un devis envoyé dont la date de validité est dépassée est présenté comme expiré. */
function effectiveStatus(quote: Pick<Quote, "status" | "validUntil">, today: string): QuoteStatus {
  return quote.status === "SENT" && quote.validUntil && toIsoDate(quote.validUntil) < today ? "EXPIRED" : quote.status;
}

function toListItem(quote: Quote & { customer: { name: string } }, today: string): QuoteListItem {
  return {
    id: quote.id,
    number: quote.number,
    status: effectiveStatus(quote, today),
    customerId: quote.customerId,
    customerName: quote.customer.name,
    subject: quote.subject,
    issueDate: toIsoDate(quote.issueDate),
    validUntil: quote.validUntil ? toIsoDate(quote.validUntil) : null,
    totalExclTax: quote.totalExclTax.toFixed(2),
    totalInclTax: quote.totalInclTax.toFixed(2),
  };
}

function quoteTotals(quote: QuoteWithDetail) {
  return computeDocumentTotals(
    quote.items.map((item) => ({
      quantity: item.quantity.toString(),
      unitPriceExclTax: item.unitPriceExclTax.toString(),
      discountRate: item.discountRate.toString(),
      vatRate: item.vatRate.toString(),
    })),
    { type: quote.discountType, value: quote.discountValue.toString() },
  );
}

export function serializeQuote(quote: QuoteWithDetail): QuoteView {
  const totals = quoteTotals(quote);
  return {
    ...toListItem(quote, todayInParis()),
    notes: quote.notes,
    terms: quote.terms,
    discountType: quote.discountType,
    discountValue: new Decimal(quote.discountValue.toString()).toString(),
    discountAmount: totals.discountAmount.toFixed(2),
    subtotalExclTax: totals.subtotalExclTax.toFixed(2),
    totalVat: quote.totalVat.toFixed(2),
    vatBreakdown: totals.vatBreakdown.map((row) => ({ rate: row.rate.toString(), base: row.base.toFixed(2), vat: row.vat.toFixed(2) })),
    customerEmail: quote.customer.email,
    items: quote.items.map(serializeItem),
    invoices: quote.invoices.map((i) => ({ id: i.id, number: i.number, type: i.type, status: i.status, totalInclTax: i.totalInclTax.toFixed(2) })),
    sentAt: quote.sentAt?.toISOString() ?? null,
    acceptedAt: quote.acceptedAt?.toISOString() ?? null,
  };
}

export const QUOTE_FILTERS = ["all", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "INVOICED"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];

export async function listQuotes(access: CompanyAccess, options: { q?: string; filter?: string; page?: number; pageSize?: number } = {}) {
  const { q, page = 1, pageSize = 25 } = options;
  const filter = QUOTE_FILTERS.includes(options.filter as QuoteFilter) ? (options.filter as QuoteFilter) : "all";
  const today = fromIsoDate(todayInParis());
  const statusWhere: Prisma.QuoteWhereInput =
    filter === "all"
      ? {}
      : filter === "EXPIRED"
        ? { status: "SENT", validUntil: { lt: today } }
        : filter === "SENT"
          ? { status: "SENT", OR: [{ validUntil: null }, { validUntil: { gte: today } }] }
          : { status: filter };
  const where: Prisma.QuoteWhereInput = {
    AND: [statusWhere, q ? { OR: [{ number: { contains: q } }, { subject: { contains: q } }, { customer: { name: { contains: q } } }] } : {}],
  };
  const [items, total] = await Promise.all([
    access.db.quote.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: [{ issueDate: "desc" }, { number: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    access.db.quote.count({ where }),
  ]);
  const todayIso = todayInParis();
  return { items: items.map((quote) => toListItem(quote, todayIso)), total, page, pageSize, filter };
}

export async function getQuoteDetail(access: CompanyAccess, quoteId: string): Promise<QuoteWithDetail> {
  const quote = await access.db.quote.findFirst({ where: { id: quoteId }, include: detailInclude });
  if (!quote) throw errors.notFound("Devis introuvable.");
  return quote;
}

export async function getQuoteHistory(access: CompanyAccess, quoteId: string): Promise<HistoryEntry[]> {
  return documentHistory(access.company.id, "Quote", quoteId);
}

export async function createQuote(access: CompanyAccess, userId: string, input: QuoteInput, meta: Meta = {}): Promise<QuoteWithDetail> {
  const companyId = access.company.id;
  const customer = await resolveActiveCustomer(access, input.customerId);
  const prepared = await prepareDocumentLines(access, input.items, { type: input.discountType, value: input.discountValue });
  const validUntil = input.validUntil ?? addDays(input.issueDate, access.company.quoteValidityDays);
  const year = Number(input.issueDate.slice(0, 4));

  const quote = await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const rank = await takeNextNumber(tx, companyId, "QUOTE", year);
      return tx.quote.create({
        data: {
          companyId,
          customerId: customer.id,
          number: formatDocumentNumber(access.company.quotePrefix, year, rank),
          issueDate: fromIsoDate(input.issueDate),
          validUntil: fromIsoDate(validUntil),
          subject: input.subject ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          discountType: input.discountType,
          discountValue: input.discountValue,
          ...totalsData(prepared.totals),
          createdById: userId,
          items: { create: prepared.rows },
        },
        include: detailInclude,
      });
    }),
  );
  await recordAudit({ action: "quote.create", userId, companyId, entityType: "Quote", entityId: quote.id, metadata: { detail: `Devis ${quote.number} créé` }, ...meta });
  return quote;
}

async function requireEditable(access: CompanyAccess, quoteId: string) {
  const quote = await access.db.quote.findFirst({ where: { id: quoteId } });
  if (!quote) throw errors.notFound("Devis introuvable.");
  if (quote.status !== "DRAFT") {
    throw errors.conflict("QUOTE_LOCKED", "Seul un devis en brouillon peut être modifié. Repassez-le en brouillon pour le corriger.");
  }
  return quote;
}

export async function updateQuote(access: CompanyAccess, userId: string, quoteId: string, input: QuoteInput, meta: Meta = {}): Promise<QuoteWithDetail> {
  await requireEditable(access, quoteId);
  const customer = await resolveActiveCustomer(access, input.customerId);
  const prepared = await prepareDocumentLines(access, input.items, { type: input.discountType, value: input.discountValue });
  const quote = await prisma.$transaction(async (tx) => {
    const guarded = await tx.quote.updateMany({
      where: { id: quoteId, companyId: access.company.id, status: "DRAFT" },
      data: {
        customerId: customer.id,
        issueDate: fromIsoDate(input.issueDate),
        validUntil: fromIsoDate(input.validUntil ?? addDays(input.issueDate, access.company.quoteValidityDays)),
        subject: input.subject ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        ...totalsData(prepared.totals),
      },
    });
    if (guarded.count !== 1) throw errors.conflict("QUOTE_LOCKED", "Ce devis n'est plus modifiable.");
    await tx.quoteItem.deleteMany({ where: { quoteId } });
    await tx.quoteItem.createMany({ data: prepared.rows.map((row) => ({ ...row, quoteId })) });
    return tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: detailInclude });
  });
  await recordAudit({ action: "quote.update", userId, companyId: access.company.id, entityType: "Quote", entityId: quoteId, metadata: { detail: "Devis modifié" }, ...meta });
  return quote;
}

export async function deleteQuote(access: CompanyAccess, userId: string, quoteId: string, meta: Meta = {}): Promise<void> {
  await requireEditable(access, quoteId);
  const deleted = await access.db.quote.deleteMany({ where: { id: quoteId, status: "DRAFT" } });
  if (deleted.count !== 1) throw errors.conflict("QUOTE_LOCKED", "Ce devis n'est plus supprimable.");
  await recordAudit({ action: "quote.delete", userId, companyId: access.company.id, entityType: "Quote", entityId: quoteId, ...meta });
}

const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "DRAFT"],
  ACCEPTED: ["SENT"],
  REJECTED: ["DRAFT", "SENT"],
  EXPIRED: [],
  INVOICED: [],
};

export async function setQuoteStatus(access: CompanyAccess, userId: string | null, quoteId: string, status: QuoteStatus, meta: Meta = {}): Promise<QuoteWithDetail> {
  const quote = await getQuoteDetail(access, quoteId);
  if (quote.status === status) return quote;
  if (!TRANSITIONS[quote.status].includes(status)) {
    throw errors.conflict(
      "INVALID_TRANSITION",
      `Un devis « ${QUOTE_STATUS_LABELS[quote.status].toLowerCase()} » ne peut pas passer à l'état « ${QUOTE_STATUS_LABELS[status].toLowerCase()} ».`,
    );
  }
  if (quote.status === "ACCEPTED" && quote.invoices.some((invoice) => invoice.status !== "CANCELLED")) {
    throw errors.conflict("QUOTE_HAS_INVOICES", "Ce devis a déjà donné lieu à une facture : son acceptation ne peut plus être annulée.");
  }
  const updated = await access.db.quote.update({
    where: { id: quoteId },
    data: {
      status,
      sentAt: status === "SENT" ? (quote.sentAt ?? new Date()) : quote.sentAt,
      acceptedAt: status === "ACCEPTED" ? new Date() : status === "SENT" || status === "DRAFT" ? null : quote.acceptedAt,
    },
    include: detailInclude,
  });
  await recordAudit({
    action: `quote.${status.toLowerCase()}`,
    userId,
    companyId: access.company.id,
    entityType: "Quote",
    entityId: quoteId,
    metadata: { detail: `Devis passé à l'état « ${QUOTE_STATUS_LABELS[status].toLowerCase()} »` },
    ...meta,
  });
  return updated;
}

/** Acomptes déjà facturés sur un devis (brouillons compris), hors factures annulées. */
function depositInvoices(quote: QuoteWithDetail) {
  return quote.invoices.filter((invoice) => invoice.type === "DEPOSIT" && invoice.status !== "CANCELLED");
}

/**
 * Transforme un devis en facture (brouillon) :
 *  - « invoice » : facture reprenant les lignes du devis, acomptes émis déduits ;
 *  - « deposit » : facture d'acompte d'un pourcentage du devis, ventilée par taux de TVA.
 */
export async function convertQuote(
  access: CompanyAccess,
  userId: string,
  quoteId: string,
  input: { mode: "invoice" } | { mode: "deposit"; percent: string },
  meta: Meta = {},
): Promise<InvoiceWithDetail> {
  const quote = await getQuoteDetail(access, quoteId);
  const today = todayInParis();
  if (quote.status !== "ACCEPTED" && quote.status !== "SENT") {
    throw errors.conflict("QUOTE_NOT_ACCEPTED", "Seul un devis envoyé ou accepté peut être facturé.");
  }
  const totals = quoteTotals(quote);
  const deposits = depositInvoices(quote);

  let invoice: InvoiceWithDetail;
  if (input.mode === "deposit") {
    if (!(await companyHasModule(access.company.id, "invoicing-advanced"))) {
      throw new AppError(403, "PLAN_FEATURE_UNAVAILABLE", "Les factures d'acompte sont incluses à partir de la formule Pro.");
    }
    const percent = new Decimal(input.percent);
    const alreadyInvoiced = deposits.reduce((acc, d) => acc.plus(dec(d.totalInclTax)), new Decimal(0));
    const items: DocumentLineInput[] = totals.vatBreakdown
      .filter((row) => row.base.greaterThan(0))
      .map((row) => ({
        description: `Acompte de ${percent.toString().replace(".", ",")} % sur le devis ${quote.number}${quote.subject ? ` — ${quote.subject}` : ""}`,
        quantity: "1",
        unitPriceExclTax: roundMoney(row.base.times(percent).dividedBy(100)).toFixed(2),
        discountRate: "0",
        vatRate: row.rate.toString(),
      }));
    if (items.length === 0) throw errors.badRequest("EMPTY_QUOTE", "Ce devis n'a aucun montant à facturer.");
    const depositTotal = computeDocumentTotals(items).totalInclTax;
    if (alreadyInvoiced.plus(depositTotal).greaterThan(totals.totalInclTax)) {
      throw errors.conflict("DEPOSIT_EXCEEDS_QUOTE", "Le total des acomptes dépasserait le montant du devis.");
    }
    invoice = await createInvoiceDraft(
      access,
      userId,
      { customerId: quote.customerId, issueDate: today, subject: `Acompte sur le devis ${quote.number}`, discountType: "NONE", discountValue: "0", operationCategory: "SERVICES", items },
      meta,
      { type: "DEPOSIT", quoteId: quote.id },
    );
  } else {
    if (quote.invoices.some((i) => i.type === "INVOICE" && i.status !== "CANCELLED")) {
      throw errors.conflict("QUOTE_ALREADY_INVOICED", "Ce devis a déjà été facturé.");
    }
    if (deposits.some((d) => d.status === "DRAFT")) {
      throw errors.conflict("DEPOSIT_DRAFT_PENDING", "Émettez ou supprimez la facture d'acompte en brouillon avant d'établir la facture finale.");
    }
    const items: DocumentLineInput[] = quote.items.map((item) => ({
      productId: item.productId ?? undefined,
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit ?? undefined,
      unitPriceExclTax: item.unitPriceExclTax.toString(),
      discountRate: item.discountRate.toString(),
      vatRate: item.vatRate.toString(),
    }));
    // Déduction des acomptes émis : une ligne négative par ligne d'acompte, au même taux de TVA.
    if (deposits.length > 0) {
      const issuedDeposits = await access.db.invoice.findMany({
        where: { id: { in: deposits.map((d) => d.id) } },
        include: { items: { orderBy: { position: "asc" } } },
        orderBy: { issueDate: "asc" },
      });
      for (const deposit of issuedDeposits) {
        for (const item of deposit.items) {
          items.push({
            description: `Acompte déjà facturé — facture ${deposit.number} du ${formatIsoForHumans(toIsoDate(deposit.issueDate!))}`,
            quantity: "1",
            unitPriceExclTax: dec(item.totalExclTax).negated().toFixed(2),
            discountRate: "0",
            vatRate: item.vatRate.toString(),
          });
        }
      }
    }
    invoice = await createInvoiceDraft(
      access,
      userId,
      {
        customerId: quote.customerId,
        issueDate: today,
        subject: quote.subject ?? `Facture du devis ${quote.number}`,
        notes: quote.notes ?? undefined,
        discountType: quote.discountType,
        discountValue: quote.discountValue.toString(),
        operationCategory: "SERVICES",
        items,
      },
      meta,
      { type: "INVOICE", quoteId: quote.id },
    );
    await access.db.quote.update({ where: { id: quote.id }, data: { status: "INVOICED", acceptedAt: quote.acceptedAt ?? new Date() } });
  }

  if (quote.status === "SENT" && input.mode === "deposit") {
    await access.db.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
  }
  await recordAudit({
    action: "quote.convert",
    userId,
    companyId: access.company.id,
    entityType: "Quote",
    entityId: quote.id,
    metadata: { detail: input.mode === "deposit" ? `Facture d'acompte de ${input.percent} % préparée` : "Facture préparée à partir du devis", invoiceId: invoice.id },
    ...meta,
  });
  return invoice;
}

export async function quotesCsv(access: CompanyAccess): Promise<string> {
  const today = todayInParis();
  const quotes = await access.db.quote.findMany({ include: { customer: { select: { name: true } } }, orderBy: [{ issueDate: "asc" }, { number: "asc" }] });
  return toCsv(
    ["Numéro", "Statut", "Date", "Valable jusqu'au", "Client", "Objet", "Total HT", "TVA", "Total TTC"],
    quotes.map((quote) => [
      quote.number,
      QUOTE_STATUS_LABELS[effectiveStatus(quote, today)],
      formatIsoForHumans(toIsoDate(quote.issueDate)),
      quote.validUntil ? formatIsoForHumans(toIsoDate(quote.validUntil)) : "",
      quote.customer.name,
      quote.subject,
      csvAmount(quote.totalExclTax),
      csvAmount(quote.totalVat),
      csvAmount(quote.totalInclTax),
    ]),
  );
}
