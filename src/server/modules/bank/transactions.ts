import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import type { BankTransaction, CategorizationRule, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { documentsForEntity, type DocumentView } from "@/server/modules/documents/service";
import { documentHistory, type HistoryEntry, type Meta } from "@/server/modules/invoicing/shared";
import { TRANSACTION_STATUS_LABELS } from "@/lib/bank";
import { sum, toMoneyString } from "@/lib/money";
import { formatIsoForHumans, fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import type { ManualTransactionInput, TransactionsQuery, TransactionUpdateInput } from "@/lib/schemas/bank";
import { getBankAccount } from "./accounts";
import { syncAccountingFor } from "@/server/modules/accounting/sync";
import { loadActiveRules, resolveCategory } from "./categories";
import { fingerprintTransactions, ruleMatches, vatIncluded } from "./labels";
import { parseAmount } from "./parsers/types";
import { computeTransactionStatus, refreshTransactionState, UNJUSTIFIED_WHERE } from "./status";

/** Opérations bancaires : consultation, saisie manuelle, catégorisation, historique. */

const listInclude = {
  category: { select: { id: true, name: true, kind: true, color: true } },
  bankAccount: { select: { id: true, name: true } },
  payments: { select: { amount: true } },
  purchase: { select: { id: true, label: true, reference: true, supplier: { select: { name: true } } } },
} satisfies Prisma.BankTransactionInclude;

type TransactionRow = Prisma.BankTransactionGetPayload<{ include: typeof listInclude }>;

export type TransactionView = {
  id: string;
  date: string;
  valueDate: string | null;
  label: string;
  rawLabel: string | null;
  amount: string;
  currency: string;
  status: BankTransaction["status"];
  account: { id: string; name: string };
  category: { id: string; name: string; kind: string; color: string | null } | null;
  vatRate: string | null;
  vatAmount: string | null;
  documentCount: number;
  /** Montant déjà affecté à des factures (encaissements). */
  allocated: string;
  isDuplicateSuspect: boolean;
  /** Facture d'achat réglée par ce décaissement. */
  purchase: { id: string; label: string; reference: string | null; supplierName: string | null } | null;
  /** Saisie à la main : date et montant restent modifiables. */
  manual: boolean;
  notes: string | null;
};

export function newTransactionId(): string {
  return `bt${randomBytes(11).toString("hex")}`;
}

export function serializeTransaction(row: TransactionRow): TransactionView {
  return {
    id: row.id,
    date: toIsoDate(row.date),
    valueDate: row.valueDate ? toIsoDate(row.valueDate) : null,
    label: row.label,
    rawLabel: row.rawLabel,
    amount: toMoneyString(row.amount),
    currency: row.currency,
    status: row.status,
    account: row.bankAccount,
    category: row.category,
    vatRate: row.vatRate ? new Decimal(row.vatRate.toString()).toString() : null,
    vatAmount: row.vatAmount ? toMoneyString(row.vatAmount) : null,
    documentCount: row.documentCount,
    allocated: toMoneyString(sum(row.payments.map((p) => p.amount))),
    isDuplicateSuspect: row.isDuplicateSuspect,
    purchase: row.purchase ? { id: row.purchase.id, label: row.purchase.label, reference: row.purchase.reference, supplierName: row.purchase.supplier?.name ?? null } : null,
    manual: row.importId === null && row.externalId === null,
    notes: row.notes,
  };
}

// --- Liste et filtres -------------------------------------------------------------------

function buildWhere(query: TransactionsQuery): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (query.accountId) and.push({ bankAccountId: query.accountId });
  if (query.status) and.push({ status: query.status });
  if (query.direction) and.push({ amount: query.direction === "IN" ? { gt: 0 } : { lt: 0 } });
  if (query.categoryId) and.push({ categoryId: query.categoryId === "none" ? null : query.categoryId });
  if (query.flag === "unjustified") and.push(UNJUSTIFIED_WHERE);
  if (query.flag === "duplicates") and.push({ isDuplicateSuspect: true });
  if (query.from || query.to) and.push({ date: { ...(query.from ? { gte: fromIsoDate(query.from) } : {}), ...(query.to ? { lte: fromIsoDate(query.to) } : {}) } });
  if (query.q) {
    const or: Prisma.BankTransactionWhereInput[] = [{ label: { contains: query.q } }, { notes: { contains: query.q } }];
    // Une recherche numérique (« 115,20 ») porte aussi sur le montant, quel que soit son sens.
    const amount = /\d/.test(query.q) ? parseAmount(query.q) : null;
    if (amount) or.push({ amount: { in: [amount, new Decimal(amount).negated().toFixed(2)] } });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

export async function listTransactions(access: CompanyAccess, query: TransactionsQuery = {}) {
  const { page = 1, pageSize = 50 } = query;
  const where = buildWhere(query);
  const scope = query.accountId ? { bankAccountId: query.accountId } : {};
  const [rows, total, inflow, outflow, toReview, unjustified, duplicates] = await Promise.all([
    access.db.bankTransaction.findMany({ where, include: listInclude, orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    access.db.bankTransaction.count({ where }),
    access.db.bankTransaction.aggregate({ where: { AND: [where, { amount: { gt: 0 } }] }, _sum: { amount: true } }),
    access.db.bankTransaction.aggregate({ where: { AND: [where, { amount: { lt: 0 } }] }, _sum: { amount: true } }),
    access.db.bankTransaction.count({ where: { ...scope, status: "TO_REVIEW" } }),
    access.db.bankTransaction.count({ where: { ...scope, ...UNJUSTIFIED_WHERE } }),
    access.db.bankTransaction.count({ where: { ...scope, isDuplicateSuspect: true } }),
  ]);
  return {
    items: rows.map(serializeTransaction),
    total,
    page,
    pageSize,
    totals: { inflow: toMoneyString(inflow._sum.amount), outflow: toMoneyString(outflow._sum.amount) },
    summary: { toReview, unjustified, duplicates },
  };
}

export async function transactionsCsv(access: CompanyAccess, query: TransactionsQuery = {}): Promise<string> {
  const rows = await access.db.bankTransaction.findMany({ where: buildWhere(query), include: listInclude, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 20_000 });
  return toCsv(
    ["Date", "Compte", "Libellé", "Montant", "Catégorie", "Taux de TVA", "TVA", "Statut", "Justificatifs", "Note"],
    rows.map((row) => [toIsoDate(row.date), row.bankAccount.name, row.label, csvAmount(row.amount), row.category?.name ?? "", row.vatRate ? csvAmount(row.vatRate) : "", row.vatAmount ? csvAmount(row.vatAmount) : "", TRANSACTION_STATUS_LABELS[row.status], row.documentCount, row.notes ?? ""]),
  );
}

// --- Détail -----------------------------------------------------------------------------

async function findRow(access: CompanyAccess, transactionId: string): Promise<TransactionRow> {
  const row = await access.db.bankTransaction.findFirst({ where: { id: transactionId }, include: listInclude });
  if (!row) throw errors.notFound("Opération bancaire introuvable.");
  return row;
}

export async function getTransaction(access: CompanyAccess, transactionId: string): Promise<TransactionView> {
  return serializeTransaction(await findRow(access, transactionId));
}

export type TransactionPaymentView = { id: string; amount: string; invoiceId: string; invoiceNumber: string | null; customerName: string; createdFromBank: boolean };

export type TransactionDetail = {
  transaction: TransactionView;
  source: { fileName: string; importedAt: string } | null;
  payments: TransactionPaymentView[];
  documents: DocumentView[];
  history: HistoryEntry[];
  /** Opérations du même compte, de même date et de même montant (à comparer en cas de doublon suspecté). */
  similar: TransactionView[];
};

export async function getTransactionDetail(access: CompanyAccess, transactionId: string): Promise<TransactionDetail> {
  const row = await findRow(access, transactionId);
  const [source, payments, documents, history, similar] = await Promise.all([
    row.importId ? access.db.bankImport.findFirst({ where: { id: row.importId }, select: { fileName: true, createdAt: true } }) : null,
    access.db.payment.findMany({ where: { bankTransactionId: row.id }, include: { invoice: { select: { number: true, customer: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
    documentsForEntity(access, "BANK_TRANSACTION", row.id),
    documentHistory(access.company.id, "BankTransaction", row.id),
    access.db.bankTransaction.findMany({ where: { bankAccountId: row.bankAccountId, date: row.date, amount: row.amount, id: { not: row.id } }, include: listInclude, take: 10 }),
  ]);
  return {
    transaction: serializeTransaction(row),
    source: source ? { fileName: source.fileName, importedAt: source.createdAt.toISOString() } : null,
    payments: payments.map((p) => ({ id: p.id, amount: toMoneyString(p.amount), invoiceId: p.invoiceId, invoiceNumber: p.invoice.number, customerName: p.invoice.customer.name, createdFromBank: p.createdFromBank })),
    documents,
    history,
    similar: similar.map(serializeTransaction),
  };
}

// --- Saisie manuelle --------------------------------------------------------------------

export async function createManualTransaction(access: CompanyAccess, userId: string, input: ManualTransactionInput, meta: Meta = {}): Promise<TransactionView> {
  const companyId = access.company.id;
  const account = await getBankAccount(access, input.bankAccountId);
  if (!account.isActive) throw errors.validation([{ path: "bankAccountId", message: "Ce compte est archivé" }]);
  if (input.date > todayInParis()) throw errors.validation([{ path: "date", message: "La date ne peut pas être dans le futur" }]);
  const category = input.categoryId ? await resolveCategory(companyId, input.categoryId) : null;
  const amount = input.direction === "OUT" ? new Decimal(input.amount).negated().toFixed(2) : new Decimal(input.amount).toFixed(2);
  const [fingerprint] = fingerprintTransactions([{ date: input.date, label: input.label, amount }]);
  const twin = await access.db.bankTransaction.count({ where: { bankAccountId: account.id, date: fromIsoDate(input.date), amount } });
  const id = newTransactionId();
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.create({
      data: {
        id,
        companyId,
        bankAccountId: account.id,
        date: fromIsoDate(input.date),
        label: input.label,
        amount,
        currency: account.currency,
        categoryId: category?.id ?? null,
        vatRate: input.vatRate ?? null,
        vatAmount: input.vatRate ? vatIncluded(amount, input.vatRate) : null,
        status: computeTransactionStatus({ amount, categoryId: category?.id ?? null, allocated: 0, documentCount: 0 }),
        fingerprint,
        // Une opération de même date et de même montant existe déjà sur ce compte : à vérifier.
        isDuplicateSuspect: twin > 0,
        notes: input.notes ?? null,
      },
    });
    await recordAudit({ action: "bank.transaction.create", userId, companyId, entityType: "BankTransaction", entityId: id, metadata: { detail: "Opération saisie manuellement" }, ...meta }, tx);
  });
  await syncAccountingFor(access.company, [{ type: "BANK_TRANSACTION", id }]);
  return getTransaction(access, id);
}

// --- Modification -----------------------------------------------------------------------

const percent = (rate: string) => `${new Decimal(rate).toString().replace(".", ",")} %`;

export async function updateTransaction(access: CompanyAccess, userId: string, transactionId: string, input: TransactionUpdateInput, meta: Meta = {}): Promise<TransactionView> {
  const companyId = access.company.id;
  const current = await findRow(access, transactionId);
  const view = serializeTransaction(current);
  const data: Prisma.BankTransactionUncheckedUpdateInput = {};
  const changes: string[] = [];

  if (input.label !== undefined && input.label !== current.label) {
    data.label = input.label;
    // Le libellé d'origine fourni par la banque est conservé.
    data.rawLabel = current.rawLabel ?? current.label;
    changes.push(`Libellé : « ${current.label} » → « ${input.label} »`);
  }
  if (input.notes !== undefined && (input.notes || null) !== current.notes) {
    data.notes = input.notes || null;
    changes.push(input.notes ? "Note modifiée" : "Note effacée");
  }
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    if (input.categoryId === null) {
      data.categoryId = null;
      changes.push(`Catégorie retirée (« ${current.category?.name ?? "—"} »)`);
    } else {
      const category = await resolveCategory(companyId, input.categoryId);
      data.categoryId = category.id;
      changes.push(`Catégorie : ${current.category ? `« ${current.category.name} »` : "aucune"} → « ${category.name} »`);
    }
  }

  let amount = view.amount;
  const wantsBankData = input.date !== undefined || input.amount !== undefined || input.direction !== undefined;
  if (wantsBankData) {
    const direction = input.direction ?? (view.amount.startsWith("-") ? "OUT" : "IN");
    const absolute = input.amount ?? new Decimal(view.amount).abs().toFixed(2);
    const nextAmount = direction === "OUT" ? new Decimal(absolute).negated().toFixed(2) : new Decimal(absolute).toFixed(2);
    const nextDate = input.date ?? view.date;
    if (nextAmount !== view.amount || nextDate !== view.date) {
      if (!view.manual) throw errors.conflict("BANK_DATA_IMMUTABLE", "La date et le montant d'une opération importée proviennent de la banque et ne sont pas modifiables.");
      if (current.payments.length > 0) throw errors.conflict("TRANSACTION_RECONCILED", "Annulez d'abord le rapprochement de cette opération avec ses factures.");
      if (nextDate > todayInParis()) throw errors.validation([{ path: "date", message: "La date ne peut pas être dans le futur" }]);
      if (nextAmount !== view.amount) changes.push(`Montant : ${view.amount.replace(".", ",")} € → ${nextAmount.replace(".", ",")} €`);
      if (nextDate !== view.date) changes.push(`Date : ${formatIsoForHumans(view.date)} → ${formatIsoForHumans(nextDate)}`);
      amount = nextAmount;
      data.amount = nextAmount;
      data.date = fromIsoDate(nextDate);
      [data.fingerprint] = fingerprintTransactions([{ date: nextDate, label: input.label ?? current.label, amount: nextAmount }]);
    }
  }

  let rate = view.vatRate;
  if (input.vatRate !== undefined && (input.vatRate === null ? view.vatRate !== null : view.vatRate === null || !new Decimal(input.vatRate).equals(view.vatRate))) {
    rate = input.vatRate;
    data.vatRate = input.vatRate;
    changes.push(input.vatRate === null ? "TVA retirée" : `TVA : ${percent(input.vatRate)}`);
  }
  if (data.vatRate !== undefined || data.amount !== undefined) data.vatAmount = rate === null ? null : vatIncluded(amount, rate);

  if (changes.length === 0) return view;
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.updateMany({ where: { id: transactionId, companyId }, data });
    await refreshTransactionState(tx, companyId, transactionId);
    await recordAudit({ action: "bank.transaction.update", userId, companyId, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: changes.join(" · ") }, ...meta }, tx);
  });
  await syncAccountingFor(access.company, [{ type: "BANK_TRANSACTION", id: transactionId }]);
  return getTransaction(access, transactionId);
}

/** Catégorise plusieurs opérations en une fois. */
export async function bulkCategorize(access: CompanyAccess, userId: string, input: { ids: string[]; categoryId: string; vatRate?: string }, meta: Meta = {}): Promise<{ updated: number }> {
  const companyId = access.company.id;
  const category = await resolveCategory(companyId, input.categoryId);
  const ids = [...new Set(input.ids)];
  const rows = await access.db.bankTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, amount: true, categoryId: true } });
  if (rows.length !== ids.length) throw errors.notFound("Certaines opérations sont introuvables.");
  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        await tx.bankTransaction.updateMany({
          where: { id: row.id, companyId },
          data: { categoryId: category.id, ...(input.vatRate ? { vatRate: input.vatRate, vatAmount: vatIncluded(row.amount, input.vatRate) } : {}) },
        });
        await refreshTransactionState(tx, companyId, row.id);
      }
      await tx.auditLog.createMany({
        data: rows.map((row) => ({
          action: "bank.transaction.update",
          userId,
          companyId,
          actorType: "USER" as const,
          entityType: "BankTransaction",
          entityId: row.id,
          metadata: { detail: `Catégorie « ${category.name} » appliquée (sélection multiple)${input.vatRate ? ` · TVA : ${percent(input.vatRate)}` : ""}` },
          ipAddress: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        })),
      });
    },
    { timeout: 30_000 },
  );
  await syncAccountingFor(access.company, rows.map((row) => ({ type: "BANK_TRANSACTION" as const, id: row.id })));
  return { updated: rows.length };
}

/** Lève le signalement de doublon : l'utilisateur confirme que l'opération est légitime. */
export async function dismissDuplicate(access: CompanyAccess, userId: string, transactionId: string, meta: Meta = {}): Promise<TransactionView> {
  const row = await findRow(access, transactionId);
  if (row.isDuplicateSuspect) {
    await access.db.bankTransaction.update({ where: { id: transactionId }, data: { isDuplicateSuspect: false } });
    await recordAudit({ action: "bank.transaction.duplicate_dismissed", userId, companyId: access.company.id, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: "Signalement de doublon levé : opération confirmée" }, ...meta });
  }
  return getTransaction(access, transactionId);
}

/**
 * Supprime une opération (doublon avéré, saisie erronée). Refusé tant qu'elle est
 * rapprochée de factures : le rapprochement doit d'abord être annulé.
 */
export async function deleteTransaction(access: CompanyAccess, userId: string, transactionId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  const row = await findRow(access, transactionId);
  if (row.payments.length > 0) throw errors.conflict("TRANSACTION_RECONCILED", "Cette opération est rapprochée de factures : annulez d'abord le rapprochement.");
  await prisma.$transaction(async (tx) => {
    await tx.documentLink.deleteMany({ where: { companyId, entityType: "BANK_TRANSACTION", entityId: transactionId } });
    await tx.bankTransaction.deleteMany({ where: { id: transactionId, companyId } });
    await recordAudit(
      {
        action: "bank.transaction.delete",
        userId,
        companyId,
        entityType: "BankTransaction",
        entityId: transactionId,
        metadata: { detail: "Opération supprimée", date: toIsoDate(row.date), label: row.label, amount: toMoneyString(row.amount), account: row.bankAccount.name },
        ...meta,
      },
      tx,
    );
  });
  await syncAccountingFor(access.company, [{ type: "BANK_TRANSACTION", id: transactionId }]);
}

// --- Règles automatiques ----------------------------------------------------------------

/** Première règle applicable à une opération, dans l'ordre de priorité. */
export function matchRule(rules: CategorizationRule[], transaction: { label: string; amount: string }): CategorizationRule | null {
  return rules.find((rule) => ruleMatches(rule, transaction)) ?? null;
}

/** Applique les règles aux opérations sans catégorie. Les opérations déjà catégorisées ne sont jamais modifiées. */
export async function applyRulesToUncategorized(access: CompanyAccess, userId: string, meta: Meta = {}): Promise<{ examined: number; categorized: number }> {
  const companyId = access.company.id;
  const rules = await loadActiveRules(access);
  const rows = await access.db.bankTransaction.findMany({ where: { categoryId: null }, select: { id: true, label: true, amount: true }, orderBy: { date: "desc" }, take: 5000 });
  if (rules.length === 0 || rows.length === 0) return { examined: rows.length, categorized: 0 };
  const categories = new Map((await prisma.transactionCategory.findMany({ where: { id: { in: rules.map((r) => r.categoryId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const matches = rows.flatMap((row) => {
    const rule = matchRule(rules, { label: row.label, amount: toMoneyString(row.amount) });
    return rule ? [{ row, rule }] : [];
  });
  for (let start = 0; start < matches.length; start += 200) {
    const chunk = matches.slice(start, start + 200);
    await prisma.$transaction(
      async (tx) => {
        for (const { row, rule } of chunk) {
          await tx.bankTransaction.updateMany({
            where: { id: row.id, companyId, categoryId: null },
            data: { categoryId: rule.categoryId, ...(rule.vatRate ? { vatRate: rule.vatRate, vatAmount: vatIncluded(row.amount, rule.vatRate) } : {}) },
          });
          await refreshTransactionState(tx, companyId, row.id);
        }
        await tx.auditLog.createMany({
          data: chunk.map(({ row, rule }) => ({
            action: "bank.transaction.auto_categorized",
            userId,
            companyId,
            actorType: "USER" as const,
            entityType: "BankTransaction",
            entityId: row.id,
            metadata: { detail: `Catégorie « ${categories.get(rule.categoryId) ?? "—"} » appliquée par la règle « ${rule.name} »`, ruleId: rule.id },
            ipAddress: meta.ip ?? null,
            userAgent: meta.userAgent ?? null,
          })),
        });
      },
      { timeout: 30_000 },
    );
  }
  await syncAccountingFor(access.company, matches.map(({ row }) => ({ type: "BANK_TRANSACTION" as const, id: row.id })));
  return { examined: rows.length, categorized: matches.length };
}

