import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { accountTypeFor } from "@/config/chart-of-accounts";
import { dec, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { ensureAccountingReady } from "./sync";

/** Plan comptable et journaux de l'entreprise. */

export type AccountView = { id: string; number: string; label: string; type: string; isSystem: boolean; isActive: boolean; balance: string; lineCount: number };

export async function listAccounts(access: CompanyAccess, options: { q?: string; used?: boolean } = {}): Promise<AccountView[]> {
  await ensureAccountingReady(access.company);
  const where: Prisma.AccountingAccountWhereInput = options.q ? { OR: [{ number: { startsWith: options.q } }, { label: { contains: options.q } }] } : {};
  const [accounts, totals] = await Promise.all([
    access.db.accountingAccount.findMany({ where, orderBy: { number: "asc" } }),
    access.db.accountingEntryLine.groupBy({ by: ["accountId"], where: { entry: { fiscalYear: { status: "OPEN" } } }, _sum: { debit: true, credit: true }, _count: { _all: true } }),
  ]);
  const byAccount = new Map(totals.map((t) => [t.accountId, t]));
  return accounts
    .map((a) => {
      const t = byAccount.get(a.id);
      return { id: a.id, number: a.number, label: a.label, type: a.type, isSystem: a.isSystem, isActive: a.isActive, balance: toMoneyString(dec(t?._sum.debit).minus(dec(t?._sum.credit))), lineCount: t?._count._all ?? 0 };
    })
    .filter((a) => !options.used || a.lineCount > 0);
}

export async function createAccount(access: CompanyAccess, userId: string, input: { number: string; label: string }, meta: Meta = {}): Promise<AccountView> {
  const companyId = access.company.id;
  await ensureAccountingReady(access.company);
  if (await access.db.accountingAccount.findFirst({ where: { number: input.number } })) throw errors.validation([{ path: "number", message: "Ce numéro de compte existe déjà" }]);
  const account = await access.db.accountingAccount.create({ data: { companyId, number: input.number, label: input.label, type: accountTypeFor(input.number) } });
  await recordAudit({ action: "accounting.account.create", userId, companyId, entityType: "AccountingAccount", entityId: account.id, metadata: { number: input.number, label: input.label }, ...meta });
  return (await listAccounts(access, { q: input.number })).find((a) => a.id === account.id)!;
}

/** Intitulé et activation. Un compte de référence garde son numéro ; un compte désactivé ne reçoit plus de saisie manuelle. */
export async function updateAccount(access: CompanyAccess, userId: string, accountId: string, input: { label: string; isActive: boolean }, meta: Meta = {}): Promise<AccountView> {
  const account = await access.db.accountingAccount.findFirst({ where: { id: accountId } });
  if (!account) throw errors.notFound("Compte introuvable.");
  await access.db.accountingAccount.update({ where: { id: accountId }, data: { label: input.label, isActive: input.isActive } });
  await recordAudit({ action: "accounting.account.update", userId, companyId: access.company.id, entityType: "AccountingAccount", entityId: accountId, metadata: { number: account.number, label: input.label, isActive: input.isActive }, ...meta });
  return (await listAccounts(access, { q: account.number })).find((a) => a.id === accountId)!;
}

export async function listJournals(access: CompanyAccess) {
  await ensureAccountingReady(access.company);
  const [journals, counts] = await Promise.all([
    access.db.accountingJournal.findMany({ orderBy: { code: "asc" } }),
    access.db.accountingEntry.groupBy({ by: ["journalId", "status"], _count: { _all: true } }),
  ]);
  return journals.map((j) => ({
    id: j.id,
    code: j.code,
    label: j.label,
    type: j.type,
    isActive: j.isActive,
    entries: counts.filter((c) => c.journalId === j.id).reduce((acc, c) => acc + c._count._all, 0),
    drafts: counts.find((c) => c.journalId === j.id && c.status === "DRAFT")?._count._all ?? 0,
  }));
}

/** Vue d'ensemble : brouillard, exercice en cours, comptes à surveiller. */
export async function accountingOverview(access: CompanyAccess) {
  const today = todayInParis();
  await ensureAccountingReady(access.company);
  const year = await access.db.fiscalYear.findFirst({ where: { startDate: { lte: fromIsoDate(today) }, endDate: { gte: fromIsoDate(today) } } });
  const [drafts, oldestDraft, suspense, openYears, errorsCount] = await Promise.all([
    access.db.accountingEntry.count({ where: { status: "DRAFT" } }),
    access.db.accountingEntry.findFirst({ where: { status: "DRAFT" }, orderBy: { date: "asc" }, select: { date: true } }),
    access.db.accountingEntryLine.aggregate({ where: { account: { number: "471000" }, entry: { fiscalYear: { status: "OPEN" } } }, _sum: { debit: true, credit: true } }),
    access.db.fiscalYear.findMany({ where: { status: "OPEN", endDate: { lt: fromIsoDate(today) } }, orderBy: { startDate: "asc" }, select: { id: true, label: true, endDate: true } }),
    prisma.applicationError.count({ where: { path: `accounting-sync:${access.company.id}`, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
  ]);
  return {
    fiscalYear: year ? { id: year.id, label: year.label, startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate), lockedThrough: year.lockedThrough ? toIsoDate(year.lockedThrough) : null } : null,
    draftCount: drafts,
    oldestDraft: oldestDraft ? toIsoDate(oldestDraft.date) : null,
    suspenseBalance: toMoneyString(dec(suspense._sum.debit).minus(dec(suspense._sum.credit))),
    yearsToClose: openYears.map((y) => ({ id: y.id, label: y.label, endDate: toIsoDate(y.endDate) })),
    syncErrors: errorsCount,
  };
}
