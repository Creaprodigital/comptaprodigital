import type { Invoice, InvoiceStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { addDays, formatIsoForHumans, fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { dec, toMoneyString, ZERO } from "@/lib/money";
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS, computeDocumentTotals, formatDocumentNumber, remainingAmount } from "@/lib/invoicing";
import type { DocumentLineInput, InvoiceInput, PaymentInput } from "@/lib/schemas/invoicing";
import {
  buildPartiesSnapshot,
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

const OPEN_STATUSES: InvoiceStatus[] = ["ISSUED", "SENT", "PARTIALLY_PAID"];

const detailInclude = {
  items: { orderBy: { position: "asc" } },
  customer: true,
  payments: { orderBy: { paidAt: "asc" } },
  creditNotes: { select: { id: true, number: true, status: true, totalInclTax: true, issueDate: true } },
  originalInvoice: { select: { id: true, number: true } },
  quote: { select: { id: true, number: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithDetail = Prisma.InvoiceGetPayload<{ include: typeof detailInclude }>;

export type InvoiceListItem = {
  id: string;
  type: Invoice["type"];
  status: Invoice["status"];
  number: string | null;
  customerId: string;
  customerName: string;
  subject: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalExclTax: string;
  totalInclTax: string;
  remaining: string;
  overdue: boolean;
};

export type InvoiceView = InvoiceListItem & {
  serviceDate: string | null;
  notes: string | null;
  paymentTerms: string | null;
  operationCategory: Invoice["operationCategory"];
  vatExigibility: Invoice["vatExigibility"];
  discountType: Invoice["discountType"];
  discountValue: string;
  discountAmount: string;
  subtotalExclTax: string;
  totalVat: string;
  vatBreakdown: Array<{ rate: string; base: string; vat: string }>;
  amountPaid: string;
  creditedAmount: string;
  customerEmail: string | null;
  items: ItemView[];
  payments: Array<{ id: string; amount: string; paidAt: string; method: string; reference: string | null; note: string | null; linkedToBank: boolean }>;
  creditNotes: Array<{ id: string; number: string | null; status: string; totalInclTax: string }>;
  originalInvoice: { id: string; number: string | null } | null;
  quote: { id: string; number: string } | null;
  recurringInvoiceId: string | null;
  issuedAt: string | null;
  sentAt: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
};

function isOverdue(invoice: Pick<Invoice, "status" | "dueDate" | "type">, today: string): boolean {
  return invoice.type !== "CREDIT_NOTE" && OPEN_STATUSES.includes(invoice.status) && invoice.dueDate !== null && toIsoDate(invoice.dueDate) < today;
}

function toListItem(invoice: Invoice & { customer: { name: string } }, today: string): InvoiceListItem {
  return {
    id: invoice.id,
    type: invoice.type,
    status: invoice.status,
    number: invoice.number,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    subject: invoice.subject,
    issueDate: invoice.issueDate ? toIsoDate(invoice.issueDate) : null,
    dueDate: invoice.dueDate ? toIsoDate(invoice.dueDate) : null,
    totalExclTax: invoice.totalExclTax.toFixed(2),
    totalInclTax: invoice.totalInclTax.toFixed(2),
    remaining: invoice.type === "CREDIT_NOTE" || invoice.status === "DRAFT" || invoice.status === "CANCELLED" ? "0.00" : toMoneyString(Decimal.max(remainingAmount(invoice), 0)),
    overdue: isOverdue(invoice, today),
  };
}

export function serializeInvoice(invoice: InvoiceWithDetail): InvoiceView {
  const totals = computeDocumentTotals(
    invoice.items.map((item) => ({
      quantity: item.quantity.toString(),
      unitPriceExclTax: item.unitPriceExclTax.toString(),
      discountRate: item.discountRate.toString(),
      vatRate: item.vatRate.toString(),
    })),
    { type: invoice.discountType, value: invoice.discountValue.toString() },
  );
  return {
    ...toListItem(invoice, todayInParis()),
    serviceDate: invoice.serviceDate ? toIsoDate(invoice.serviceDate) : null,
    notes: invoice.notes,
    paymentTerms: invoice.paymentTerms,
    operationCategory: invoice.operationCategory,
    vatExigibility: invoice.vatExigibility,
    discountType: invoice.discountType,
    discountValue: new Decimal(invoice.discountValue.toString()).toString(),
    discountAmount: totals.discountAmount.toFixed(2),
    subtotalExclTax: totals.subtotalExclTax.toFixed(2),
    totalVat: invoice.totalVat.toFixed(2),
    vatBreakdown: totals.vatBreakdown.map((row) => ({ rate: row.rate.toString(), base: row.base.toFixed(2), vat: row.vat.toFixed(2) })),
    amountPaid: invoice.amountPaid.toFixed(2),
    creditedAmount: invoice.creditedAmount.toFixed(2),
    customerEmail: invoice.customer.email,
    items: invoice.items.map(serializeItem),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amount: p.amount.toFixed(2),
      paidAt: toIsoDate(p.paidAt),
      method: p.method,
      reference: p.reference,
      note: p.note,
      linkedToBank: p.bankTransactionId !== null,
    })),
    creditNotes: invoice.creditNotes.map((cn) => ({ id: cn.id, number: cn.number, status: cn.status, totalInclTax: cn.totalInclTax.toFixed(2) })),
    originalInvoice: invoice.originalInvoice,
    quote: invoice.quote,
    recurringInvoiceId: invoice.recurringInvoiceId,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    reminderCount: invoice.reminderCount,
    lastReminderAt: invoice.lastReminderAt?.toISOString() ?? null,
  };
}

// --- Lecture --------------------------------------------------------------------

export const INVOICE_FILTERS = ["all", "draft", "unpaid", "overdue", "paid", "credit_note"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

function filterWhere(filter: InvoiceFilter, today: string): Prisma.InvoiceWhereInput {
  switch (filter) {
    case "draft":
      return { status: "DRAFT" };
    case "unpaid":
      return { type: { in: ["INVOICE", "DEPOSIT"] }, status: { in: OPEN_STATUSES } };
    case "overdue":
      return { type: { in: ["INVOICE", "DEPOSIT"] }, status: { in: OPEN_STATUSES }, dueDate: { lt: fromIsoDate(today) } };
    case "paid":
      return { status: "PAID" };
    case "credit_note":
      return { type: "CREDIT_NOTE" };
    default:
      return {};
  }
}

export async function listInvoices(access: CompanyAccess, options: { q?: string; filter?: string; page?: number; pageSize?: number; customerId?: string } = {}) {
  const { q, page = 1, pageSize = 25, customerId } = options;
  const filter = INVOICE_FILTERS.includes(options.filter as InvoiceFilter) ? (options.filter as InvoiceFilter) : "all";
  const today = todayInParis();
  const where: Prisma.InvoiceWhereInput = {
    ...filterWhere(filter, today),
    ...(customerId ? { customerId } : {}),
    ...(q ? { OR: [{ number: { contains: q } }, { subject: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    access.db.invoice.findMany({
      where,
      include: { customer: { select: { name: true } } },
      // Les brouillons (sans numéro) en tête, puis du plus récent au plus ancien.
      orderBy: [{ issuedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    access.db.invoice.count({ where }),
  ]);
  return { items: items.map((invoice) => toListItem(invoice, today)), total, page, pageSize, filter };
}

export async function getInvoiceDetail(access: CompanyAccess, invoiceId: string): Promise<InvoiceWithDetail> {
  const invoice = await access.db.invoice.findFirst({ where: { id: invoiceId }, include: detailInclude });
  if (!invoice) throw errors.notFound("Facture introuvable.");
  return invoice;
}

export async function getInvoiceHistory(access: CompanyAccess, invoiceId: string): Promise<HistoryEntry[]> {
  return documentHistory(access.company.id, "Invoice", invoiceId);
}

// --- Brouillons -----------------------------------------------------------------

function vatExigibilityFor(access: CompanyAccess, type: Invoice["type"], operationCategory: Invoice["operationCategory"]) {
  // Acomptes : TVA exigible à l'encaissement. Biens : à la livraison (débits). Services : selon l'option de l'entreprise.
  if (type === "DEPOSIT") return "ENCAISSEMENTS" as const;
  if (operationCategory === "GOODS") return "DEBITS" as const;
  return access.company.vatExigibility;
}

type DraftOptions = {
  type?: Invoice["type"];
  quoteId?: string | null;
  originalInvoiceId?: string | null;
  recurringInvoiceId?: string | null;
};

export async function createInvoiceDraft(
  access: CompanyAccess,
  userId: string | null,
  input: InvoiceInput,
  meta: Meta = {},
  options: DraftOptions = {},
): Promise<InvoiceWithDetail> {
  const type = options.type ?? "INVOICE";
  const customer = await resolveActiveCustomer(access, input.customerId);
  const prepared = await prepareDocumentLines(access, input.items, { type: input.discountType, value: input.discountValue });
  const termDays = customer.paymentTermDays ?? access.company.defaultPaymentTermDays;
  const dueDate = type === "CREDIT_NOTE" ? null : (input.dueDate ?? addDays(input.issueDate, termDays));

  const invoice = await access.db.invoice.create({
    data: {
      companyId: access.company.id,
      customerId: customer.id,
      type,
      status: "DRAFT",
      issueDate: fromIsoDate(input.issueDate),
      dueDate: dueDate ? fromIsoDate(dueDate) : null,
      serviceDate: input.serviceDate ? fromIsoDate(input.serviceDate) : null,
      quoteId: options.quoteId ?? null,
      originalInvoiceId: options.originalInvoiceId ?? null,
      recurringInvoiceId: options.recurringInvoiceId ?? null,
      subject: input.subject ?? null,
      notes: input.notes ?? null,
      paymentTerms: input.paymentTerms ?? null,
      operationCategory: input.operationCategory,
      vatExigibility: vatExigibilityFor(access, type, input.operationCategory),
      discountType: input.discountType,
      discountValue: input.discountValue,
      ...totalsData(prepared.totals),
      createdById: userId,
      items: { create: prepared.rows },
    },
    include: detailInclude,
  });
  await recordAudit({
    action: "invoice.create",
    userId,
    companyId: access.company.id,
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { detail: `Brouillon créé (${INVOICE_TYPE_LABELS[type].toLowerCase()})` },
    ...meta,
  });
  return invoice;
}

async function requireDraft(access: CompanyAccess, invoiceId: string) {
  const invoice = await access.db.invoice.findFirst({ where: { id: invoiceId } });
  if (!invoice) throw errors.notFound("Facture introuvable.");
  if (invoice.status !== "DRAFT") {
    throw errors.conflict("INVOICE_LOCKED", "Une facture émise ne peut plus être modifiée ni supprimée. Corrigez-la par un avoir.");
  }
  return invoice;
}

export async function updateInvoiceDraft(access: CompanyAccess, userId: string, invoiceId: string, input: InvoiceInput, meta: Meta = {}): Promise<InvoiceWithDetail> {
  const draft = await requireDraft(access, invoiceId);
  if (draft.type === "CREDIT_NOTE") {
    throw errors.conflict("CREDIT_NOTE_NOT_EDITABLE", "Un avoir en brouillon ne se modifie pas : supprimez-le et recréez-le depuis la facture d'origine.");
  }
  const customer = await resolveActiveCustomer(access, input.customerId);
  const prepared = await prepareDocumentLines(access, input.items, { type: input.discountType, value: input.discountValue });
  const termDays = customer.paymentTermDays ?? access.company.defaultPaymentTermDays;
  const dueDate = input.dueDate ?? addDays(input.issueDate, termDays);

  const invoice = await prisma.$transaction(async (tx) => {
    // Double garde : la mise à jour n'aboutit que si la facture est toujours un brouillon.
    const guarded = await tx.invoice.updateMany({
      where: { id: invoiceId, companyId: access.company.id, status: "DRAFT" },
      data: {
        customerId: customer.id,
        issueDate: fromIsoDate(input.issueDate),
        dueDate: fromIsoDate(dueDate),
        serviceDate: input.serviceDate ? fromIsoDate(input.serviceDate) : null,
        subject: input.subject ?? null,
        notes: input.notes ?? null,
        paymentTerms: input.paymentTerms ?? null,
        operationCategory: input.operationCategory,
        vatExigibility: vatExigibilityFor(access, draft.type, input.operationCategory),
        discountType: input.discountType,
        discountValue: input.discountValue,
        ...totalsData(prepared.totals),
      },
    });
    if (guarded.count !== 1) throw errors.conflict("INVOICE_LOCKED", "Cette facture vient d'être émise et ne peut plus être modifiée.");
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoiceItem.createMany({ data: prepared.rows.map((row) => ({ ...row, invoiceId })) });
    return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: detailInclude });
  });
  await recordAudit({ action: "invoice.update", userId, companyId: access.company.id, entityType: "Invoice", entityId: invoiceId, metadata: { detail: "Brouillon modifié" }, ...meta });
  return invoice;
}

export async function deleteInvoiceDraft(access: CompanyAccess, userId: string, invoiceId: string, meta: Meta = {}): Promise<void> {
  const draft = await requireDraft(access, invoiceId);
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.invoice.deleteMany({ where: { id: invoiceId, companyId: access.company.id, status: "DRAFT" } });
    if (deleted.count !== 1) throw errors.conflict("INVOICE_LOCKED", "Cette facture vient d'être émise et ne peut plus être supprimée.");
    // Le devis redevient facturable si sa facture finale en brouillon est supprimée.
    if (draft.quoteId && draft.type === "INVOICE") {
      await tx.quote.updateMany({ where: { id: draft.quoteId, companyId: access.company.id, status: "INVOICED" }, data: { status: "ACCEPTED" } });
    }
  });
  await recordAudit({ action: "invoice.delete_draft", userId, companyId: access.company.id, entityType: "Invoice", entityId: invoiceId, ...meta });
}

// --- Émission -------------------------------------------------------------------

/** Statut d'une facture émise d'après ses règlements et ses avoirs. */
export function settledStatus(invoice: Pick<Invoice, "totalInclTax" | "amountPaid" | "creditedAmount" | "sentAt">): InvoiceStatus {
  if (remainingAmount(invoice).lessThanOrEqualTo(0)) return "PAID";
  if (dec(invoice.amountPaid).greaterThan(0)) return "PARTIALLY_PAID";
  return invoice.sentAt ? "SENT" : "ISSUED";
}

/**
 * Émet une facture ou un avoir : attribution du numéro dans la séquence
 * chronologique, figeage des parties et verrouillage définitif.
 */
export async function issueInvoice(access: CompanyAccess, userId: string | null, invoiceId: string, meta: Meta = {}): Promise<InvoiceWithDetail> {
  const companyId = access.company.id;
  const today = todayInParis();

  const issued = await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const draft = await tx.invoice.findFirst({
          where: { id: invoiceId, companyId },
          include: { items: { orderBy: { position: "asc" } }, customer: true, originalInvoice: true },
        });
        if (!draft) throw errors.notFound("Facture introuvable.");
        if (draft.status !== "DRAFT") throw errors.conflict("ALREADY_ISSUED", "Cette facture a déjà été émise.");
        if (draft.items.length === 0) throw errors.badRequest("EMPTY_INVOICE", "Une facture doit comporter au moins une ligne.");

        const issueDate = draft.issueDate ? toIsoDate(draft.issueDate) : today;
        if (issueDate > today) {
          throw errors.badRequest("ISSUE_DATE_IN_FUTURE", "La date d'émission ne peut pas être postérieure à aujourd'hui.");
        }

        // Les totaux sont recalculés une dernière fois à partir des lignes.
        const totals = computeDocumentTotals(
          draft.items.map((item) => ({
            quantity: item.quantity.toString(),
            unitPriceExclTax: item.unitPriceExclTax.toString(),
            discountRate: item.discountRate.toString(),
            vatRate: item.vatRate.toString(),
          })),
          { type: draft.discountType, value: draft.discountValue.toString() },
        );
        if (totals.totalInclTax.isNegative()) {
          throw errors.badRequest("NEGATIVE_TOTAL", "Le total d'une facture ne peut pas être négatif : établissez un avoir.");
        }

        const isCreditNote = draft.type === "CREDIT_NOTE";
        const sequence = isCreditNote ? "CREDIT_NOTE" : "INVOICE";
        const year = Number(issueDate.slice(0, 4));
        const rank = await takeNextNumber(tx, companyId, sequence, year);

        // Chronologie : pas de date antérieure à celle du dernier document émis dans la même séquence.
        const latest = await tx.invoice.findFirst({
          where: { companyId, number: { not: null }, type: isCreditNote ? "CREDIT_NOTE" : { in: ["INVOICE", "DEPOSIT"] } },
          orderBy: { issueDate: "desc" },
          select: { issueDate: true, number: true },
        });
        if (latest?.issueDate && toIsoDate(latest.issueDate) > issueDate) {
          throw errors.conflict(
            "CHRONOLOGY_VIOLATION",
            `La date d'émission ne peut pas être antérieure à celle du dernier document émis (${latest.number} du ${formatIsoForHumans(toIsoDate(latest.issueDate))}).`,
          );
        }

        if (isCreditNote) {
          const original = draft.originalInvoice;
          if (!original || original.status === "DRAFT" || original.type === "CREDIT_NOTE") {
            throw errors.badRequest("INVALID_CREDIT_NOTE", "Un avoir doit porter sur une facture émise.");
          }
          const credited = dec(original.creditedAmount).plus(totals.totalInclTax);
          if (credited.greaterThan(dec(original.totalInclTax))) {
            throw errors.conflict("CREDIT_EXCEEDS_INVOICE", "Le total des avoirs ne peut pas dépasser le montant de la facture d'origine.");
          }
          const updatedOriginal = { ...original, creditedAmount: credited };
          const status = settledStatus(updatedOriginal);
          await tx.invoice.update({
            where: { id: original.id },
            data: { creditedAmount: credited.toFixed(2), status, paidAt: status === "PAID" ? (original.paidAt ?? new Date()) : null },
          });
        }

        const prefix = isCreditNote ? access.company.creditNotePrefix : access.company.invoicePrefix;
        const number = formatDocumentNumber(prefix, year, rank);
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        await tx.invoice.update({
          where: { id: draft.id },
          data: {
            number,
            status: "ISSUED",
            issueDate: fromIsoDate(issueDate),
            issuedAt: new Date(),
            partiesSnapshot: buildPartiesSnapshot(company, draft.customer) as unknown as Prisma.InputJsonValue,
            ...totalsData(totals),
          },
        });
        await recordAudit(
          {
            action: "invoice.issue",
            userId,
            companyId,
            entityType: "Invoice",
            entityId: draft.id,
            metadata: { detail: `${INVOICE_TYPE_LABELS[draft.type]} émise sous le numéro ${number}`, number },
            ...meta,
          },
          tx,
        );
        return tx.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: detailInclude });
      },
      { timeout: 20_000, maxWait: 10_000 },
    ),
  );
  return issued;
}

// --- Avoirs ---------------------------------------------------------------------

/** Crée le brouillon d'un avoir (total par défaut, ou partiel si des lignes sont fournies). */
export async function createCreditNote(
  access: CompanyAccess,
  userId: string,
  invoiceId: string,
  input: { reason: string; items?: DocumentLineInput[] },
  meta: Meta = {},
): Promise<InvoiceWithDetail> {
  const original = await getInvoiceDetail(access, invoiceId);
  if (original.status === "DRAFT" || original.type === "CREDIT_NOTE" || !original.number) {
    throw errors.badRequest("INVALID_CREDIT_NOTE", "Un avoir ne peut porter que sur une facture émise.");
  }
  const pendingDraft = await access.db.invoice.findFirst({ where: { originalInvoiceId: original.id, type: "CREDIT_NOTE", status: "DRAFT" } });
  if (pendingDraft) throw errors.conflict("CREDIT_NOTE_PENDING", "Un avoir en brouillon existe déjà pour cette facture.");

  const partial = Boolean(input.items?.length);
  const items: DocumentLineInput[] = partial
    ? input.items!
    : original.items.map((item) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit ?? undefined,
        unitPriceExclTax: item.unitPriceExclTax.toString(),
        discountRate: item.discountRate.toString(),
        vatRate: item.vatRate.toString(),
      }));
  const discount = partial ? { type: "NONE" as const, value: "0" } : { type: original.discountType, value: original.discountValue.toString() };

  const prepared = await prepareDocumentLines(access, items, discount);
  if (dec(original.creditedAmount).plus(prepared.totals.totalInclTax).greaterThan(dec(original.totalInclTax))) {
    throw errors.conflict("CREDIT_EXCEEDS_INVOICE", "Le total des avoirs ne peut pas dépasser le montant de la facture d'origine.");
  }

  const creditNote = await access.db.invoice.create({
    data: {
      companyId: access.company.id,
      customerId: original.customerId,
      type: "CREDIT_NOTE",
      status: "DRAFT",
      issueDate: fromIsoDate(todayInParis()),
      originalInvoiceId: original.id,
      subject: `Avoir sur la facture ${original.number} — ${input.reason}`.slice(0, 255),
      operationCategory: original.operationCategory,
      vatExigibility: original.vatExigibility,
      discountType: discount.type,
      discountValue: discount.value,
      ...totalsData(prepared.totals),
      createdById: userId,
      items: { create: prepared.rows },
    },
    include: detailInclude,
  });
  await recordAudit({
    action: "invoice.credit_note_draft",
    userId,
    companyId: access.company.id,
    entityType: "Invoice",
    entityId: original.id,
    metadata: { detail: `Avoir préparé (${input.reason})`, creditNoteId: creditNote.id },
    ...meta,
  });
  return creditNote;
}

// --- Règlements -----------------------------------------------------------------

export async function recordPayment(access: CompanyAccess, userId: string, invoiceId: string, input: PaymentInput, meta: Meta = {}): Promise<InvoiceWithDetail> {
  const companyId = access.company.id;
  if (input.paidAt > todayInParis()) throw errors.validation([{ path: "paidAt", message: "La date de règlement ne peut pas être dans le futur" }]);

  const updated = await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      // Verrou sur la facture : deux règlements simultanés ne peuvent pas dépasser le reste dû.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM invoices WHERE id = ${invoiceId} AND companyId = ${companyId} FOR UPDATE`;
      if (locked.length === 0) throw errors.notFound("Facture introuvable.");
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (invoice.type === "CREDIT_NOTE") throw errors.badRequest("NOT_PAYABLE", "Un avoir ne reçoit pas de règlement.");
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") throw errors.badRequest("NOT_PAYABLE", "Seule une facture émise peut être réglée.");
      if (invoice.issueDate && input.paidAt < toIsoDate(invoice.issueDate) && invoice.type !== "DEPOSIT") {
        // Un règlement antérieur à la facture relève d'un acompte : on le signale sans le bloquer pour les acomptes.
        throw errors.validation([{ path: "paidAt", message: "La date de règlement précède la date de la facture" }]);
      }
      const remaining = remainingAmount(invoice);
      const amount = new Decimal(input.amount);
      if (amount.greaterThan(remaining)) {
        throw errors.validation([{ path: "amount", message: `Le montant dépasse le reste à encaisser (${remaining.toFixed(2).replace(".", ",")} €)` }]);
      }
      await tx.payment.create({
        data: { companyId, invoiceId, amount: amount.toFixed(2), paidAt: fromIsoDate(input.paidAt), method: input.method, reference: input.reference ?? null, note: input.note ?? null, createdById: userId },
      });
      const amountPaid = dec(invoice.amountPaid).plus(amount);
      const status = settledStatus({ ...invoice, amountPaid });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: amountPaid.toFixed(2), status, paidAt: status === "PAID" ? fromIsoDate(input.paidAt) : null },
      });
      await recordAudit(
        {
          action: "invoice.payment",
          userId,
          companyId,
          entityType: "Invoice",
          entityId: invoiceId,
          metadata: { detail: `Règlement de ${amount.toFixed(2).replace(".", ",")} € enregistré`, amount: amount.toFixed(2) },
          ...meta,
        },
        tx,
      );
      return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: detailInclude });
    }),
  );
  return updated;
}

export async function deletePayment(access: CompanyAccess, userId: string, invoiceId: string, paymentId: string, meta: Meta = {}): Promise<InvoiceWithDetail> {
  const companyId = access.company.id;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM invoices WHERE id = ${invoiceId} AND companyId = ${companyId} FOR UPDATE`;
    if (locked.length === 0) throw errors.notFound("Facture introuvable.");
    const payment = await tx.payment.findFirst({ where: { id: paymentId, invoiceId, companyId } });
    if (!payment) throw errors.notFound("Règlement introuvable.");
    if (payment.bankTransactionId) {
      throw errors.conflict("PAYMENT_RECONCILED", "Ce règlement est rapproché d'une opération bancaire et ne peut pas être supprimé.");
    }
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await tx.payment.delete({ where: { id: paymentId } });
    const amountPaid = Decimal.max(dec(invoice.amountPaid).minus(dec(payment.amount)), ZERO);
    const status = settledStatus({ ...invoice, amountPaid });
    await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: amountPaid.toFixed(2), status, paidAt: status === "PAID" ? invoice.paidAt : null } });
    await recordAudit(
      {
        action: "invoice.payment_deleted",
        userId,
        companyId,
        entityType: "Invoice",
        entityId: invoiceId,
        metadata: { detail: `Règlement de ${payment.amount.toFixed(2).replace(".", ",")} € supprimé` },
        ...meta,
      },
      tx,
    );
    return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: detailInclude });
  });
}

/** Marque la facture comme envoyée (premier envoi) sans modifier son contenu. */
export async function markInvoiceSent(companyId: string, invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice || invoice.status === "DRAFT") return;
  const sentAt = invoice.sentAt ?? new Date();
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { sentAt, status: invoice.status === "ISSUED" ? "SENT" : invoice.status },
  });
}

// --- Export ---------------------------------------------------------------------

export async function invoicesCsv(access: CompanyAccess): Promise<string> {
  const today = todayInParis();
  const invoices = await access.db.invoice.findMany({
    where: { status: { not: "DRAFT" } },
    include: { customer: { select: { name: true, siren: true } } },
    orderBy: [{ issueDate: "asc" }, { number: "asc" }],
  });
  return toCsv(
    ["Numéro", "Type", "Statut", "Date d'émission", "Échéance", "Client", "SIREN client", "Objet", "Total HT", "TVA", "Total TTC", "Réglé", "Avoirs", "Reste à encaisser", "En retard"],
    invoices.map((invoice) => [
      invoice.number,
      INVOICE_TYPE_LABELS[invoice.type],
      INVOICE_STATUS_LABELS[invoice.status],
      invoice.issueDate ? formatIsoForHumans(toIsoDate(invoice.issueDate)) : "",
      invoice.dueDate ? formatIsoForHumans(toIsoDate(invoice.dueDate)) : "",
      invoice.customer.name,
      invoice.customer.siren,
      invoice.subject,
      csvAmount(invoice.totalExclTax),
      csvAmount(invoice.totalVat),
      csvAmount(invoice.totalInclTax),
      csvAmount(invoice.amountPaid),
      csvAmount(invoice.creditedAmount),
      invoice.type === "CREDIT_NOTE" ? "" : csvAmount(Decimal.max(remainingAmount(invoice), 0)),
      isOverdue(invoice, today) ? "Oui" : "Non",
    ]),
  );
}

export { AppError };
