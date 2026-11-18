import type { AccountingEntry, EntrySource, EntryStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { checkEntryLines } from "@/lib/accounting";
import { dec, toMoneyString, ZERO } from "@/lib/money";
import { formatIsoForHumans, fromIsoDate, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";
import { ensureAccount, type Tx } from "./setup";
import { fiscalYearFor, isOpenFor } from "./fiscal-years";

/**
 * Écritures comptables.
 *
 *  - Une écriture naît au **brouillard** (DRAFT) : elle peut être modifiée ou supprimée.
 *  - La **validation** la rend intangible et lui attribue le numéro suivant de la suite
 *    continue de son exercice (EcritureNum du FEC).
 *  - Une écriture validée ne se modifie jamais : elle se corrige par une
 *    **contre-passation** (écriture inverse liée à l'originale), suivie au besoin
 *    d'une nouvelle écriture.
 *  - Aucune écriture ne peut être validée dans un exercice clôturé ou une période verrouillée.
 */

export type LineInput = {
  accountNumber: string;
  label?: string;
  debit: Decimal.Value;
  credit: Decimal.Value;
  auxiliaryNumber?: string | null;
  auxiliaryLabel?: string | null;
};

export type EntryWrite = {
  journalCode: string;
  date: IsoDate;
  label: string;
  pieceRef?: string | null;
  pieceDate?: IsoDate | null;
  lines: LineInput[];
};

type InsertOptions = { status?: EntryStatus; sourceType?: EntrySource; sourceId?: string | null; reversalOfId?: string | null; createdById?: string | null };

const entryInclude = {
  journal: { select: { id: true, code: true, label: true, type: true } },
  fiscalYear: { select: { id: true, label: true, status: true } },
  lines: { include: { account: { select: { number: true, label: true } } }, orderBy: { position: "asc" } },
  reversalOf: { select: { id: true, entryNumber: true, status: true } },
  reversedBy: { select: { id: true, entryNumber: true, status: true } },
} satisfies Prisma.AccountingEntryInclude;

export type EntryRow = Prisma.AccountingEntryGetPayload<{ include: typeof entryInclude }>;

/** Insère une écriture et ses lignes (les comptes absents sont créés à partir de leur libellé). */
export async function insertEntry(tx: Tx, company: { id: string; fiscalYearStartMonth: number }, input: EntryWrite, options: InsertOptions = {}): Promise<AccountingEntry> {
  const companyId = company.id;
  const journal = await tx.accountingJournal.findUnique({ where: { companyId_code: { companyId, code: input.journalCode } } });
  if (!journal) throw errors.validation([{ path: "journalId", message: "Journal introuvable" }]);
  const fiscalYear = await fiscalYearFor(tx, company, input.date);
  const lines: Prisma.AccountingEntryLineCreateManyEntryInput[] = [];
  for (const [position, line] of input.lines.entries()) {
    const accountId = await ensureAccount(tx, companyId, line.accountNumber, line.label ?? input.label);
    lines.push({
      companyId,
      accountId,
      position,
      label: (line.label || input.label).slice(0, 255),
      debit: dec(line.debit).toFixed(2),
      credit: dec(line.credit).toFixed(2),
      auxiliaryNumber: line.auxiliaryNumber ?? null,
      auxiliaryLabel: line.auxiliaryLabel?.slice(0, 191) ?? null,
    });
  }
  return tx.accountingEntry.create({
    data: {
      companyId,
      journalId: journal.id,
      fiscalYearId: fiscalYear.id,
      date: fromIsoDate(input.date),
      pieceRef: input.pieceRef?.slice(0, 100) ?? null,
      pieceDate: input.pieceDate ? fromIsoDate(input.pieceDate) : null,
      label: input.label.slice(0, 255),
      status: options.status ?? "DRAFT",
      sourceType: options.sourceType ?? "MANUAL",
      sourceId: options.sourceId ?? null,
      reversalOfId: options.reversalOfId ?? null,
      createdById: options.createdById ?? null,
      lines: { createMany: { data: lines } },
    },
  });
}

/** Lignes inverses d'une écriture (débit et crédit échangés). */
export function reversedLines(entry: EntryRow): LineInput[] {
  return entry.lines.map((line) => ({
    accountNumber: line.account.number,
    label: line.label,
    debit: line.credit,
    credit: line.debit,
    auxiliaryNumber: line.auxiliaryNumber,
    auxiliaryLabel: line.auxiliaryLabel,
  }));
}

/** Verrou applicatif par entreprise : sérialise numérotation, synchronisation et clôture. */
export async function lockCompany(tx: Tx, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
}

// --- Vues ---------------------------------------------------------------------------

export type EntryLineView = {
  id: string;
  accountNumber: string;
  accountLabel: string;
  label: string;
  debit: string;
  credit: string;
  auxiliaryNumber: string | null;
  auxiliaryLabel: string | null;
  letter: string | null;
};

export type EntryView = {
  id: string;
  journal: { id: string; code: string; label: string };
  fiscalYear: { id: string; label: string; closed: boolean };
  number: number | null;
  date: string;
  pieceRef: string | null;
  pieceDate: string | null;
  label: string;
  status: EntryStatus;
  sourceType: EntrySource;
  sourceId: string | null;
  /** Écriture saisie par l'utilisateur, donc modifiable tant qu'elle est au brouillard. */
  editable: boolean;
  /** Écriture du brouillard que l'utilisateur peut supprimer (saisie ou contre-passation manuelles). */
  deletable: boolean;
  reversalOf: { id: string; number: number | null } | null;
  reversedBy: { id: string; number: number | null; status: EntryStatus } | null;
  validatedAt: string | null;
  total: string;
  lines: EntryLineView[];
};

/** Écritures modifiables par l'utilisateur au brouillard (les autres découlent de leur pièce d'origine). */
const EDITABLE_SOURCES: EntrySource[] = ["MANUAL"];

export function serializeEntry(entry: EntryRow): EntryView {
  return {
    id: entry.id,
    journal: { id: entry.journal.id, code: entry.journal.code, label: entry.journal.label },
    fiscalYear: { id: entry.fiscalYear.id, label: entry.fiscalYear.label, closed: entry.fiscalYear.status === "CLOSED" },
    number: entry.entryNumber,
    date: toIsoDate(entry.date),
    pieceRef: entry.pieceRef,
    pieceDate: entry.pieceDate ? toIsoDate(entry.pieceDate) : null,
    label: entry.label,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    editable: entry.status === "DRAFT" && EDITABLE_SOURCES.includes(entry.sourceType) && entry.reversalOfId === null,
    deletable: entry.status === "DRAFT" && EDITABLE_SOURCES.includes(entry.sourceType),
    reversalOf: entry.reversalOf ? { id: entry.reversalOf.id, number: entry.reversalOf.entryNumber } : null,
    reversedBy: entry.reversedBy ? { id: entry.reversedBy.id, number: entry.reversedBy.entryNumber, status: entry.reversedBy.status } : null,
    validatedAt: entry.validatedAt?.toISOString() ?? null,
    total: toMoneyString(entry.lines.reduce((acc, l) => acc.plus(dec(l.debit)), ZERO)),
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountNumber: line.account.number,
      accountLabel: line.account.label,
      label: line.label,
      debit: toMoneyString(line.debit),
      credit: toMoneyString(line.credit),
      auxiliaryNumber: line.auxiliaryNumber,
      auxiliaryLabel: line.auxiliaryLabel,
      letter: line.letter,
    })),
  };
}

export type EntriesQuery = {
  journalId?: string;
  status?: EntryStatus;
  fiscalYearId?: string;
  from?: IsoDate;
  to?: IsoDate;
  q?: string;
  source?: EntrySource;
  page?: number;
  pageSize?: number;
};

export async function listEntries(access: CompanyAccess, query: EntriesQuery = {}) {
  const { page = 1, pageSize = 30 } = query;
  const where: Prisma.AccountingEntryWhereInput = {};
  if (query.journalId) where.journalId = query.journalId;
  if (query.status) where.status = query.status;
  if (query.fiscalYearId) where.fiscalYearId = query.fiscalYearId;
  if (query.source) where.sourceType = query.source;
  if (query.from || query.to) where.date = { ...(query.from ? { gte: fromIsoDate(query.from) } : {}), ...(query.to ? { lte: fromIsoDate(query.to) } : {}) };
  if (query.q) {
    const number = /^\d+$/.test(query.q) ? Number(query.q) : null;
    where.OR = [{ label: { contains: query.q } }, { pieceRef: { contains: query.q } }, { lines: { some: { account: { number: { startsWith: query.q } } } } }, ...(number ? [{ entryNumber: number }] : [])];
  }
  const [rows, total, drafts] = await Promise.all([
    access.db.accountingEntry.findMany({ where, include: entryInclude, orderBy: [{ date: "desc" }, { entryNumber: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    access.db.accountingEntry.count({ where }),
    access.db.accountingEntry.count({ where: { status: "DRAFT" } }),
  ]);
  return { items: rows.map(serializeEntry), total, page, pageSize, draftCount: drafts };
}

export async function findEntry(access: CompanyAccess, entryId: string): Promise<EntryRow> {
  const entry = await access.db.accountingEntry.findFirst({ where: { id: entryId }, include: entryInclude });
  if (!entry) throw errors.notFound("Écriture introuvable.");
  return entry;
}

export async function getEntry(access: CompanyAccess, entryId: string): Promise<EntryView> {
  return serializeEntry(await findEntry(access, entryId));
}

// --- Saisie manuelle ------------------------------------------------------------------

export type ManualEntryInput = { journalId: string; date: IsoDate; label: string; pieceRef?: string; lines: Array<{ accountNumber: string; label?: string; debit: string; credit: string; auxiliaryNumber?: string; auxiliaryLabel?: string }> };

async function checkManualInput(tx: Tx, access: CompanyAccess, input: ManualEntryInput) {
  const companyId = access.company.id;
  const journal = await tx.accountingJournal.findFirst({ where: { id: input.journalId, companyId, isActive: true } });
  if (!journal) throw errors.validation([{ path: "journalId", message: "Journal introuvable" }]);
  const check = checkEntryLines(input.lines);
  if (!check.balanced) throw errors.validation(check.errors.map((message) => ({ path: "lines", message })));
  const numbers = [...new Set(input.lines.map((l) => l.accountNumber))];
  const accounts = await tx.accountingAccount.findMany({ where: { companyId, number: { in: numbers } } });
  for (const number of numbers) {
    const account = accounts.find((a) => a.number === number);
    if (!account) throw errors.validation([{ path: "lines", message: `Le compte ${number} n'existe pas dans votre plan comptable.` }]);
    if (!account.isActive) throw errors.validation([{ path: "lines", message: `Le compte ${number} est désactivé.` }]);
  }
  const fiscalYear = await fiscalYearFor(tx, access.company, input.date);
  if (!isOpenFor(fiscalYear, input.date)) throw errors.validation([{ path: "date", message: "Cette date se trouve dans une période clôturée ou verrouillée." }]);
  return journal;
}

export async function createManualEntry(access: CompanyAccess, userId: string, input: ManualEntryInput, meta: Meta = {}): Promise<EntryView> {
  const companyId = access.company.id;
  const id = await prisma.$transaction(async (tx) => {
    const journal = await checkManualInput(tx, access, input);
    const entry = await insertEntry(tx, access.company, { ...input, journalCode: journal.code, pieceDate: input.date }, { createdById: userId });
    await recordAudit({ action: "accounting.entry.create", userId, companyId, entityType: "AccountingEntry", entityId: entry.id, metadata: { detail: `Écriture saisie au brouillard (${journal.code})` }, ...meta }, tx);
    return entry.id;
  });
  return getEntry(access, id);
}

async function editableDraft(tx: Tx, companyId: string, entryId: string, options: { allowReversal?: boolean } = {}) {
  const entry = await tx.accountingEntry.findFirst({ where: { id: entryId, companyId } });
  if (!entry) throw errors.notFound("Écriture introuvable.");
  if (entry.status !== "DRAFT") throw errors.conflict("ENTRY_VALIDATED", "Une écriture validée ne peut pas être modifiée : contre-passez-la pour la corriger.");
  if (!EDITABLE_SOURCES.includes(entry.sourceType) || (entry.reversalOfId && !options.allowReversal)) {
    throw errors.conflict("ENTRY_GENERATED", "Cette écriture découle d'une pièce (facture, opération bancaire…) : corrigez la pièce d'origine.");
  }
  return entry;
}

export async function updateManualEntry(access: CompanyAccess, userId: string, entryId: string, input: ManualEntryInput, meta: Meta = {}): Promise<EntryView> {
  const companyId = access.company.id;
  await prisma.$transaction(async (tx) => {
    const entry = await editableDraft(tx, companyId, entryId);
    const journal = await checkManualInput(tx, access, input);
    const fiscalYear = await fiscalYearFor(tx, access.company, input.date);
    await tx.accountingEntryLine.deleteMany({ where: { entryId, companyId } });
    for (const [position, line] of input.lines.entries()) {
      const accountId = await ensureAccount(tx, companyId, line.accountNumber, input.label);
      await tx.accountingEntryLine.create({
        data: { companyId, entryId, accountId, position, label: (line.label || input.label).slice(0, 255), debit: dec(line.debit).toFixed(2), credit: dec(line.credit).toFixed(2), auxiliaryNumber: line.auxiliaryNumber || null, auxiliaryLabel: line.auxiliaryLabel || null },
      });
    }
    await tx.accountingEntry.update({
      where: { id: entry.id },
      data: { journalId: journal.id, fiscalYearId: fiscalYear.id, date: fromIsoDate(input.date), pieceDate: fromIsoDate(input.date), label: input.label.slice(0, 255), pieceRef: input.pieceRef || null },
    });
    await recordAudit({ action: "accounting.entry.update", userId, companyId, entityType: "AccountingEntry", entityId: entryId, metadata: { detail: "Écriture du brouillard modifiée" }, ...meta }, tx);
  });
  return getEntry(access, entryId);
}

export async function deleteDraftEntry(access: CompanyAccess, userId: string, entryId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  await prisma.$transaction(async (tx) => {
    // Une contre-passation encore au brouillard peut être abandonnée.
    const entry = await editableDraft(tx, companyId, entryId, { allowReversal: true });
    await tx.accountingEntry.delete({ where: { id: entry.id } });
    await recordAudit({ action: "accounting.entry.delete", userId, companyId, entityType: "AccountingEntry", entityId: entryId, metadata: { detail: `Écriture du brouillard supprimée : ${entry.label}` }, ...meta }, tx);
  });
}

// --- Validation -------------------------------------------------------------------------

export type ValidationResult = { validated: number; errors: Array<{ entryId: string; label: string; message: string }> };

/**
 * Valide des écritures du brouillard. Chacune est contrôlée (équilibre, période
 * ouverte) ; les écritures valides reçoivent, dans l'ordre chronologique, le
 * numéro suivant de la suite continue de leur exercice.
 */
export async function validateEntries(access: CompanyAccess, userId: string, entryIds: string[], meta: Meta = {}): Promise<ValidationResult> {
  const companyId = access.company.id;
  return prisma.$transaction(
    async (tx) => {
      await lockCompany(tx, companyId);
      const drafts = await tx.accountingEntry.findMany({
        where: { companyId, id: { in: entryIds }, status: "DRAFT" },
        include: { lines: { include: { account: { select: { number: true } } } }, fiscalYear: true, reversalOf: { select: { status: true } } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      const result: ValidationResult = { validated: 0, errors: [] };
      const nextNumbers = new Map<string, number>();
      const validatedAt = new Date();
      const audits: Prisma.AuditLogCreateManyInput[] = [];
      for (const entry of drafts) {
        const date = toIsoDate(entry.date);
        const check = checkEntryLines(entry.lines.map((l) => ({ accountNumber: l.account.number, debit: l.debit, credit: l.credit })));
        let message: string | null = null;
        if (!check.balanced) message = check.errors[0];
        else if (!isOpenFor(entry.fiscalYear, date)) message = `La période du ${formatIsoForHumans(date)} est clôturée ou verrouillée.`;
        else if (entry.reversalOf && entry.reversalOf.status !== "VALIDATED") message = "L'écriture contre-passée doit être validée d'abord.";
        if (message) {
          result.errors.push({ entryId: entry.id, label: entry.label, message });
          continue;
        }
        if (!nextNumbers.has(entry.fiscalYearId)) {
          const max = await tx.accountingEntry.aggregate({ where: { fiscalYearId: entry.fiscalYearId }, _max: { entryNumber: true } });
          nextNumbers.set(entry.fiscalYearId, (max._max.entryNumber ?? 0) + 1);
        }
        const number = nextNumbers.get(entry.fiscalYearId)!;
        nextNumbers.set(entry.fiscalYearId, number + 1);
        await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: "VALIDATED", entryNumber: number, validatedAt, validatedById: userId } });
        audits.push({ action: "accounting.entry.validate", userId, companyId, actorType: "USER", entityType: "AccountingEntry", entityId: entry.id, metadata: { detail: `Écriture validée sous le n° ${number}` }, ipAddress: meta.ip ?? null, userAgent: meta.userAgent ?? null });
        result.validated++;
      }
      if (audits.length) await tx.auditLog.createMany({ data: audits });
      return result;
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/** Valide tout le brouillard jusqu'à une date (incluse), éventuellement pour un seul journal. */
export async function validateDraftsThrough(access: CompanyAccess, userId: string, options: { through: IsoDate; journalId?: string }, meta: Meta = {}): Promise<ValidationResult> {
  const drafts = await access.db.accountingEntry.findMany({
    where: { status: "DRAFT", date: { lte: fromIsoDate(options.through) }, ...(options.journalId ? { journalId: options.journalId } : {}) },
    select: { id: true },
    take: 5000,
  });
  if (drafts.length === 0) return { validated: 0, errors: [] };
  return validateEntries(access, userId, drafts.map((d) => d.id), meta);
}

// --- Contre-passation -----------------------------------------------------------------

/**
 * Contre-passe une écriture validée saisie manuellement : une écriture inverse
 * est créée au brouillard, liée à l'originale. Les écritures générées se
 * corrigent depuis leur pièce d'origine.
 */
export async function reverseEntry(access: CompanyAccess, userId: string, entryId: string, input: { date?: IsoDate }, meta: Meta = {}): Promise<EntryView> {
  const companyId = access.company.id;
  const id = await prisma.$transaction(async (tx) => {
    await lockCompany(tx, companyId);
    const original = await tx.accountingEntry.findFirst({ where: { id: entryId, companyId }, include: entryInclude });
    if (!original) throw errors.notFound("Écriture introuvable.");
    if (original.status !== "VALIDATED") throw errors.conflict("ENTRY_NOT_VALIDATED", "Seule une écriture validée se contre-passe ; une écriture du brouillard se modifie directement.");
    if (original.reversedBy) throw errors.conflict("ENTRY_ALREADY_REVERSED", "Cette écriture a déjà été contre-passée.");
    if (original.reversalOfId) throw errors.conflict("ENTRY_IS_REVERSAL", "Une contre-passation ne se contre-passe pas.");
    if (!EDITABLE_SOURCES.includes(original.sourceType)) {
      throw errors.conflict("ENTRY_GENERATED", "Cette écriture découle d'une pièce : corrigez la pièce d'origine, la contre-passation sera proposée automatiquement.");
    }
    const date = input.date ?? todayInParis();
    const fiscalYear = await fiscalYearFor(tx, access.company, date);
    if (!isOpenFor(fiscalYear, date)) throw errors.validation([{ path: "date", message: "Cette date se trouve dans une période clôturée ou verrouillée." }]);
    const reversal = await insertEntry(
      tx,
      access.company,
      { journalCode: original.journal.code, date, label: `Contre-passation de l'écriture n° ${original.entryNumber} — ${original.label}`, pieceRef: original.pieceRef, pieceDate: date, lines: reversedLines(original) },
      { sourceType: original.sourceType, sourceId: original.sourceId, reversalOfId: original.id, createdById: userId },
    );
    await recordAudit({ action: "accounting.entry.reverse", userId, companyId, entityType: "AccountingEntry", entityId: original.id, metadata: { detail: `Contre-passation préparée au brouillard`, reversalId: reversal.id }, ...meta }, tx);
    return reversal.id;
  });
  return getEntry(access, id);
}

