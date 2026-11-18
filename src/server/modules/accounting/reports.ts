import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { ACCOUNT_CLASS_LABELS } from "@/config/chart-of-accounts";
import { compareLetters, nextLetter } from "@/lib/accounting";
import { dec, sum, toMoneyString, ZERO } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";

/**
 * États comptables : balance générale, grand livre, journaux, comptes de tiers
 * (balance auxiliaire et lettrage) et état de rapprochement bancaire.
 * Par défaut, les écritures du brouillard sont incluses et signalées ; les états
 * officiels (FEC) ne reprennent que les écritures validées.
 */

export type ReportFilter = { fiscalYearId?: string; from?: IsoDate; to?: IsoDate; includeDrafts?: boolean; journalId?: string; account?: string };

export type ResolvedPeriod = { fiscalYear: { id: string; label: string; startDate: string; endDate: string; status: string; lockedThrough: string | null }; from: IsoDate; to: IsoDate };

/** Exercice et bornes de la période demandée (par défaut : l'exercice en cours). */
export async function resolvePeriod(access: CompanyAccess, filter: ReportFilter): Promise<ResolvedPeriod> {
  const today = todayInParis();
  const fiscalYear = filter.fiscalYearId
    ? await access.db.fiscalYear.findFirst({ where: { id: filter.fiscalYearId } })
    : ((await access.db.fiscalYear.findFirst({ where: { startDate: { lte: fromIsoDate(today) }, endDate: { gte: fromIsoDate(today) } } })) ??
      (await access.db.fiscalYear.findFirst({ orderBy: { startDate: "desc" } })));
  if (!fiscalYear) throw errors.notFound("Aucun exercice comptable.");
  const start = toIsoDate(fiscalYear.startDate);
  const end = toIsoDate(fiscalYear.endDate);
  const from = filter.from && filter.from >= start && filter.from <= end ? filter.from : start;
  const to = filter.to && filter.to <= end && filter.to >= from ? filter.to : end;
  return {
    fiscalYear: { id: fiscalYear.id, label: fiscalYear.label, startDate: start, endDate: end, status: fiscalYear.status, lockedThrough: fiscalYear.lockedThrough ? toIsoDate(fiscalYear.lockedThrough) : null },
    from,
    to,
  };
}

function statusSql(includeDrafts: boolean) {
  return includeDrafts ? Prisma.sql`` : Prisma.sql` AND e.status = 'VALIDATED'`;
}

// --- Balance générale ------------------------------------------------------------------

export type TrialBalanceRow = { accountNumber: string; accountLabel: string; debit: string; credit: string; balanceDebit: string; balanceCredit: string };

export async function trialBalance(access: CompanyAccess, filter: ReportFilter = {}) {
  const period = await resolvePeriod(access, filter);
  const includeDrafts = filter.includeDrafts ?? true;
  const rows = await prisma.$queryRaw<Array<{ number: string; label: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }>>`
    SELECT a.number AS number, a.label AS label, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    WHERE l.companyId = ${access.company.id} AND e.fiscalYearId = ${period.fiscalYear.id}
      AND e.date BETWEEN ${period.from} AND ${period.to}${statusSql(includeDrafts)}
    GROUP BY a.number, a.label
    ORDER BY a.number`;
  const accounts: TrialBalanceRow[] = rows.map((row) => {
    const balance = dec(row.debit).minus(dec(row.credit));
    return {
      accountNumber: row.number,
      accountLabel: row.label,
      debit: toMoneyString(row.debit),
      credit: toMoneyString(row.credit),
      balanceDebit: toMoneyString(balance.isPositive() ? balance : ZERO),
      balanceCredit: toMoneyString(balance.isNegative() ? balance.negated() : ZERO),
    };
  });
  const classes = Object.entries(ACCOUNT_CLASS_LABELS)
    .map(([digit, label]) => {
      const items = accounts.filter((a) => a.accountNumber.startsWith(digit));
      return {
        digit,
        label,
        debit: toMoneyString(sum(items.map((i) => i.debit))),
        credit: toMoneyString(sum(items.map((i) => i.credit))),
        balanceDebit: toMoneyString(sum(items.map((i) => i.balanceDebit))),
        balanceCredit: toMoneyString(sum(items.map((i) => i.balanceCredit))),
        accounts: items,
      };
    })
    .filter((c) => c.accounts.length > 0);
  const totals = {
    debit: toMoneyString(sum(accounts.map((a) => a.debit))),
    credit: toMoneyString(sum(accounts.map((a) => a.credit))),
    balanceDebit: toMoneyString(sum(accounts.map((a) => a.balanceDebit))),
    balanceCredit: toMoneyString(sum(accounts.map((a) => a.balanceCredit))),
  };
  // Résultat de la période : produits (classe 7) − charges (classe 6).
  const result = sum(accounts.filter((a) => a.accountNumber.startsWith("7")).map((a) => dec(a.credit).minus(dec(a.debit)))).minus(
    sum(accounts.filter((a) => a.accountNumber.startsWith("6")).map((a) => dec(a.debit).minus(dec(a.credit)))),
  );
  const drafts = await access.db.accountingEntry.count({ where: { fiscalYearId: period.fiscalYear.id, status: "DRAFT", date: { gte: fromIsoDate(period.from), lte: fromIsoDate(period.to) } } });
  return { period, includeDrafts, draftCount: drafts, classes, totals, result: toMoneyString(result), balanced: totals.debit === totals.credit };
}

export async function trialBalanceCsv(access: CompanyAccess, filter: ReportFilter = {}): Promise<string> {
  const balance = await trialBalance(access, filter);
  return toCsv(
    ["Compte", "Intitulé", "Total débit", "Total crédit", "Solde débiteur", "Solde créditeur"],
    balance.classes.flatMap((c) => c.accounts.map((a) => [a.accountNumber, a.accountLabel, csvAmount(dec(a.debit)), csvAmount(dec(a.credit)), csvAmount(dec(a.balanceDebit)), csvAmount(dec(a.balanceCredit))])),
  );
}

// --- Grand livre --------------------------------------------------------------------------

type LedgerLineRow = { id: string; number: string; label: string; lineLabel: string; entryId: string; entryNumber: number | null; date: Date; journal: string; pieceRef: string | null; status: string; debit: Prisma.Decimal; credit: Prisma.Decimal; aux: string | null; letter: string | null };

async function ledgerRows(access: CompanyAccess, period: ResolvedPeriod, options: { includeDrafts: boolean; account?: string; journalId?: string; limit?: number }) {
  const accountFilter = options.account ? Prisma.sql` AND a.number LIKE ${`${options.account}%`}` : Prisma.sql``;
  const journalFilter = options.journalId ? Prisma.sql` AND e.journalId = ${options.journalId}` : Prisma.sql``;
  return prisma.$queryRaw<LedgerLineRow[]>`
    SELECT l.id AS id, a.number AS number, a.label AS label, l.label AS lineLabel, e.id AS entryId, e.entryNumber AS entryNumber,
           e.date AS date, j.code AS journal, e.pieceRef AS pieceRef, e.status AS status, l.debit AS debit, l.credit AS credit,
           l.auxiliaryNumber AS aux, l.letter AS letter
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    INNER JOIN accounting_journals j ON j.id = e.journalId
    WHERE l.companyId = ${access.company.id} AND e.fiscalYearId = ${period.fiscalYear.id}
      AND e.date BETWEEN ${period.from} AND ${period.to}${statusSql(options.includeDrafts)}${accountFilter}${journalFilter}
    ORDER BY a.number, e.date, COALESCE(e.entryNumber, 2147483647), e.createdAt, l.position
    LIMIT ${options.limit ?? 20000}`;
}

async function openingBalances(access: CompanyAccess, period: ResolvedPeriod, includeDrafts: boolean, account?: string) {
  if (period.from === period.fiscalYear.startDate) return new Map<string, Prisma.Decimal>();
  const accountFilter = account ? Prisma.sql` AND a.number LIKE ${`${account}%`}` : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<{ number: string; balance: Prisma.Decimal }>>`
    SELECT a.number AS number, SUM(l.debit - l.credit) AS balance
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    WHERE l.companyId = ${access.company.id} AND e.fiscalYearId = ${period.fiscalYear.id} AND e.date < ${period.from}${statusSql(includeDrafts)}${accountFilter}
    GROUP BY a.number`;
  return new Map(rows.map((r) => [r.number, r.balance]));
}

export type LedgerAccount = {
  accountNumber: string;
  accountLabel: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  lines: Array<{ id: string; entryId: string; date: string; journal: string; entryNumber: number | null; pieceRef: string | null; label: string; auxiliaryNumber: string | null; debit: string; credit: string; balance: string; letter: string | null; draft: boolean }>;
};

export async function generalLedger(access: CompanyAccess, filter: ReportFilter = {}) {
  const period = await resolvePeriod(access, filter);
  const includeDrafts = filter.includeDrafts ?? true;
  const [rows, openings] = await Promise.all([ledgerRows(access, period, { includeDrafts, account: filter.account, journalId: filter.journalId }), openingBalances(access, period, includeDrafts, filter.account)]);
  const accounts = new Map<string, LedgerAccount>();
  const running = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    let account = accounts.get(row.number);
    if (!account) {
      const opening = dec(openings.get(row.number));
      running.set(row.number, opening);
      account = { accountNumber: row.number, accountLabel: row.label, opening: toMoneyString(opening), debit: "0.00", credit: "0.00", closing: "0.00", lines: [] };
      accounts.set(row.number, account);
    }
    const balance = dec(running.get(row.number)).plus(dec(row.debit)).minus(dec(row.credit));
    running.set(row.number, balance);
    account.debit = toMoneyString(dec(account.debit).plus(dec(row.debit)));
    account.credit = toMoneyString(dec(account.credit).plus(dec(row.credit)));
    account.closing = toMoneyString(balance);
    account.lines.push({
      id: row.id,
      entryId: row.entryId,
      date: toIsoDate(row.date),
      journal: row.journal,
      entryNumber: row.entryNumber,
      pieceRef: row.pieceRef,
      label: row.lineLabel,
      auxiliaryNumber: row.aux,
      debit: toMoneyString(row.debit),
      credit: toMoneyString(row.credit),
      balance: toMoneyString(balance),
      letter: row.letter,
      draft: row.status === "DRAFT",
    });
  }
  return { period, includeDrafts, accounts: [...accounts.values()], truncated: rows.length >= 20000 };
}

export async function generalLedgerCsv(access: CompanyAccess, filter: ReportFilter = {}): Promise<string> {
  const ledger = await generalLedger(access, filter);
  return toCsv(
    ["Compte", "Intitulé du compte", "Date", "Journal", "N° d'écriture", "Pièce", "Libellé", "Compte auxiliaire", "Débit", "Crédit", "Solde", "Lettrage", "Statut"],
    ledger.accounts.flatMap((a) =>
      a.lines.map((l) => [a.accountNumber, a.accountLabel, l.date, l.journal, l.entryNumber ?? "", l.pieceRef ?? "", l.label, l.auxiliaryNumber ?? "", csvAmount(dec(l.debit)), csvAmount(dec(l.credit)), csvAmount(dec(l.balance)), l.letter ?? "", l.draft ? "Brouillard" : "Validée"]),
    ),
  );
}

export async function journalCsv(access: CompanyAccess, filter: ReportFilter = {}): Promise<string> {
  const period = await resolvePeriod(access, filter);
  const includeDrafts = filter.includeDrafts ?? true;
  const journalFilter = filter.journalId ? Prisma.sql` AND e.journalId = ${filter.journalId}` : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<LedgerLineRow & { entryLabel: string }>>`
    SELECT j.code AS journal, e.entryNumber AS entryNumber, e.date AS date, e.pieceRef AS pieceRef, e.label AS entryLabel, e.status AS status,
           a.number AS number, a.label AS label, l.label AS lineLabel, l.auxiliaryNumber AS aux, l.debit AS debit, l.credit AS credit
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    INNER JOIN accounting_journals j ON j.id = e.journalId
    WHERE l.companyId = ${access.company.id} AND e.fiscalYearId = ${period.fiscalYear.id} AND e.date BETWEEN ${period.from} AND ${period.to}${statusSql(includeDrafts)}${journalFilter}
    ORDER BY j.code, e.date, COALESCE(e.entryNumber, 2147483647), e.createdAt, l.position
    LIMIT 50000`;
  return toCsv(
    ["Journal", "Date", "N° d'écriture", "Pièce", "Libellé de l'écriture", "Compte", "Intitulé du compte", "Compte auxiliaire", "Libellé", "Débit", "Crédit", "Statut"],
    rows.map((r) => [r.journal, toIsoDate(r.date), r.entryNumber ?? "", r.pieceRef ?? "", r.entryLabel, r.number, r.label, r.aux ?? "", r.lineLabel, csvAmount(dec(r.debit)), csvAmount(dec(r.credit)), r.status === "DRAFT" ? "Brouillard" : "Validée"]),
  );
}

// --- Comptes de tiers et lettrage ------------------------------------------------------------

export const THIRD_PARTY_ACCOUNTS = { customers: ["411000", "419100"], suppliers: ["401000", "404000"] } as const;

/** Balance auxiliaire : solde de chaque client ou fournisseur, toutes périodes confondues (exercices ouverts). */
export async function thirdPartyBalances(access: CompanyAccess, kind: "customers" | "suppliers") {
  const numbers = THIRD_PARTY_ACCOUNTS[kind];
  const rows = await prisma.$queryRaw<Array<{ number: string; aux: string | null; auxLabel: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal; unlettered: bigint }>>`
    SELECT a.number AS number, l.auxiliaryNumber AS aux, MAX(l.auxiliaryLabel) AS auxLabel, SUM(l.debit) AS debit, SUM(l.credit) AS credit,
           SUM(CASE WHEN l.letter IS NULL THEN 1 ELSE 0 END) AS unlettered
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    INNER JOIN fiscal_years f ON f.id = e.fiscalYearId
    WHERE l.companyId = ${access.company.id} AND a.number IN (${Prisma.join(numbers)}) AND f.status = 'OPEN'
    GROUP BY a.number, l.auxiliaryNumber
    ORDER BY MAX(l.auxiliaryLabel), a.number`;
  return rows.map((r) => ({
    accountNumber: r.number,
    auxiliaryNumber: r.aux,
    auxiliaryLabel: r.auxLabel ?? "Sans compte auxiliaire",
    debit: toMoneyString(r.debit),
    credit: toMoneyString(r.credit),
    balance: toMoneyString(dec(r.debit).minus(dec(r.credit))),
    unletteredLines: Number(r.unlettered),
  }));
}

/** Lignes d'un compte de tiers (pour le lettrage). */
export async function thirdPartyLines(access: CompanyAccess, accountNumber: string, auxiliaryNumber: string | null) {
  const account = await access.db.accountingAccount.findFirst({ where: { number: accountNumber } });
  if (!account) throw errors.notFound("Compte introuvable.");
  const lines = await access.db.accountingEntryLine.findMany({
    where: { accountId: account.id, auxiliaryNumber, entry: { fiscalYear: { status: "OPEN" } } },
    include: { entry: { select: { id: true, date: true, entryNumber: true, pieceRef: true, status: true, journal: { select: { code: true } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
    take: 2000,
  });
  return lines.map((l) => ({
    id: l.id,
    entryId: l.entry.id,
    date: toIsoDate(l.entry.date),
    journal: l.entry.journal.code,
    entryNumber: l.entry.entryNumber,
    pieceRef: l.entry.pieceRef,
    label: l.label,
    debit: toMoneyString(l.debit),
    credit: toMoneyString(l.credit),
    letter: l.letter,
    letteredAt: l.letteredAt ? toIsoDate(l.letteredAt) : null,
    draft: l.entry.status === "DRAFT",
  }));
}

/**
 * Lettrage : rapproche des lignes d'un même compte (et d'un même tiers) dont le
 * total des débits égale le total des crédits — une facture et ses règlements,
 * par exemple. Le lettrage ne modifie aucun montant : il est permis sur des
 * écritures validées (EcritureLet et DateLet du FEC).
 */
export async function letterLines(access: CompanyAccess, userId: string, lineIds: string[], meta: Meta = {}): Promise<{ letter: string }> {
  const companyId = access.company.id;
  const ids = [...new Set(lineIds)];
  return prisma.$transaction(async (tx) => {
    const lines = await tx.accountingEntryLine.findMany({ where: { companyId, id: { in: ids } }, include: { entry: { select: { status: true } }, account: { select: { number: true } } } });
    if (lines.length !== ids.length || lines.length < 2) throw errors.validation([{ path: "lineIds", message: "Sélectionnez au moins deux lignes" }]);
    if (new Set(lines.map((l) => `${l.accountId}|${l.auxiliaryNumber ?? ""}`)).size > 1) throw errors.validation([{ path: "lineIds", message: "Les lignes doivent appartenir au même compte et au même tiers" }]);
    if (lines.some((l) => l.letter)) throw errors.validation([{ path: "lineIds", message: "Une des lignes est déjà lettrée" }]);
    if (lines.some((l) => l.entry.status !== "VALIDATED")) throw errors.validation([{ path: "lineIds", message: "Seules des écritures validées se lettrent" }]);
    const balance = sum(lines.map((l) => l.debit)).minus(sum(lines.map((l) => l.credit)));
    if (!balance.isZero()) throw errors.validation([{ path: "lineIds", message: `Les lignes ne s'équilibrent pas (écart de ${balance.abs().toFixed(2).replace(".", ",")} €)` }]);
    await tx.$queryRaw`SELECT id FROM accounting_accounts WHERE id = ${lines[0].accountId} FOR UPDATE`;
    const used = await tx.accountingEntryLine.findMany({ where: { companyId, accountId: lines[0].accountId, letter: { not: null } }, select: { letter: true }, distinct: ["letter"] });
    const last = used.map((u) => u.letter!).sort(compareLetters).at(-1) ?? null;
    const letter = nextLetter(last);
    await tx.accountingEntryLine.updateMany({ where: { companyId, id: { in: ids } }, data: { letter, letteredAt: fromIsoDate(todayInParis()) } });
    await recordAudit({ action: "accounting.lettering", userId, companyId, entityType: "AccountingAccount", entityId: lines[0].accountId, metadata: { letter, lines: ids.length, account: lines[0].account.number, auxiliary: lines[0].auxiliaryNumber } as Prisma.InputJsonValue, ...meta }, tx);
    return { letter };
  });
}

export async function unletter(access: CompanyAccess, userId: string, accountNumber: string, letter: string, meta: Meta = {}): Promise<{ lines: number }> {
  const account = await access.db.accountingAccount.findFirst({ where: { number: accountNumber } });
  if (!account) throw errors.notFound("Compte introuvable.");
  const result = await access.db.accountingEntryLine.updateMany({ where: { accountId: account.id, letter }, data: { letter: null, letteredAt: null } });
  if (result.count === 0) throw errors.notFound("Lettrage introuvable.");
  await recordAudit({ action: "accounting.unlettering", userId, companyId: access.company.id, entityType: "AccountingAccount", entityId: account.id, metadata: { letter, account: accountNumber }, ...meta });
  return { lines: result.count };
}

/**
 * Lettrage automatique des comptes clients et fournisseurs : une facture avec ses
 * règlements et ses avoirs, une facture d'achat avec ses décaissements, dès que
 * le groupe s'équilibre exactement.
 */
export async function autoLetter(access: CompanyAccess, userId: string, meta: Meta = {}): Promise<{ groups: number }> {
  const accounts = await access.db.accountingAccount.findMany({ where: { number: { in: [...THIRD_PARTY_ACCOUNTS.customers, ...THIRD_PARTY_ACCOUNTS.suppliers] } } });
  const lines = await access.db.accountingEntryLine.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, letter: null, entry: { status: "VALIDATED", fiscalYear: { status: "OPEN" } } },
    include: { entry: { select: { sourceType: true, sourceId: true } } },
  });
  if (lines.length === 0) return { groups: 0 };

  // Clé de regroupement : la facture (client ou fournisseur) à laquelle se rattache la ligne.
  const sourceIds = (type: string) => [...new Set(lines.filter((l) => l.entry.sourceType === type).map((l) => l.entry.sourceId!))];
  const [payments, creditNotes, transactions] = await Promise.all([
    access.db.payment.findMany({ where: { id: { in: sourceIds("PAYMENT") } }, select: { id: true, invoiceId: true } }),
    access.db.invoice.findMany({ where: { id: { in: sourceIds("INVOICE") }, type: "CREDIT_NOTE" }, select: { id: true, originalInvoiceId: true } }),
    access.db.bankTransaction.findMany({ where: { id: { in: sourceIds("BANK_TRANSACTION") } }, select: { id: true, purchaseId: true } }),
  ]);
  const paymentInvoice = new Map(payments.map((p) => [p.id, p.invoiceId]));
  const creditOriginal = new Map(creditNotes.map((c) => [c.id, c.originalInvoiceId]));
  const txPurchase = new Map(transactions.map((t) => [t.id, t.purchaseId]));
  const keyOf = (l: (typeof lines)[number]): string | null => {
    const { sourceType, sourceId } = l.entry;
    if (!sourceId) return null;
    if (sourceType === "INVOICE") return `I:${creditOriginal.get(sourceId) ?? sourceId}`;
    if (sourceType === "PAYMENT") return paymentInvoice.has(sourceId) ? `I:${paymentInvoice.get(sourceId)}` : null;
    if (sourceType === "PURCHASE") return `P:${sourceId}`;
    if (sourceType === "BANK_TRANSACTION") return txPurchase.get(sourceId) ? `P:${txPurchase.get(sourceId)}` : null;
    return null;
  };
  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = keyOf(line);
    if (!key) continue;
    const fullKey = `${line.accountId}|${line.auxiliaryNumber ?? ""}|${key}`;
    groups.set(fullKey, [...(groups.get(fullKey) ?? []), line]);
  }
  let count = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (!sum(group.map((l) => l.debit)).minus(sum(group.map((l) => l.credit))).isZero()) continue;
    await letterLines(access, userId, group.map((l) => l.id), meta);
    count++;
  }
  return { groups: count };
}

// --- Rapprochement bancaire --------------------------------------------------------------

/**
 * État de rapprochement d'un compte bancaire à une date : solde du compte 512 en
 * comptabilité comparé au solde des opérations bancaires, avec les éléments qui
 * expliquent l'écart.
 */
export async function bankReconciliation(access: CompanyAccess, bankAccountId: string, date: IsoDate) {
  const bankAccount = await access.db.bankAccount.findFirst({ where: { id: bankAccountId } });
  if (!bankAccount) throw errors.notFound("Compte bancaire introuvable.");
  const accountNumber = bankAccount.accountNumber;
  const ledgerAccount = accountNumber ? await access.db.accountingAccount.findFirst({ where: { number: accountNumber } }) : null;
  const since = bankAccount.openingBalanceDate ? { gte: bankAccount.openingBalanceDate } : {};
  const [bankMovement, bookRows, missing, otherEntries] = await Promise.all([
    access.db.bankTransaction.aggregate({ where: { bankAccountId, date: { ...since, lte: fromIsoDate(date) } }, _sum: { amount: true } }),
    ledgerAccount
      ? access.db.accountingEntryLine.groupBy({ by: ["accountId"], where: { accountId: ledgerAccount.id, entry: { date: { lte: fromIsoDate(date) } } }, _sum: { debit: true, credit: true } })
      : [],
    // Opérations bancaires sans écriture alors qu'elles en appellent une (synchronisation à relancer).
    prisma.$queryRaw<Array<{ id: string; date: Date; label: string; amount: Prisma.Decimal }>>`
      SELECT t.id, t.date, t.label, t.amount FROM bank_transactions t
      WHERE t.companyId = ${access.company.id} AND t.bankAccountId = ${bankAccountId} AND t.date <= ${date}
        ${bankAccount.openingBalanceDate ? Prisma.sql`AND t.date >= ${toIsoDate(bankAccount.openingBalanceDate)}` : Prisma.sql``}
        AND NOT EXISTS (SELECT 1 FROM accounting_entries e WHERE e.companyId = t.companyId AND e.sourceType = 'BANK_TRANSACTION' AND e.sourceId = t.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.bankTransactionId = t.id)
      ORDER BY t.date LIMIT 100`,
    ledgerAccount
      ? access.db.accountingEntryLine.findMany({
          where: { accountId: ledgerAccount.id, entry: { date: { lte: fromIsoDate(date) }, sourceType: { in: ["MANUAL", "CLOSING"] } } },
          include: { entry: { select: { id: true, date: true, entryNumber: true, label: true, status: true } } },
          take: 100,
        })
      : [],
  ]);
  const bankBalance = dec(bankAccount.openingBalance).plus(dec(bankMovement._sum.amount));
  const book = bookRows[0] ? dec(bookRows[0]._sum.debit).minus(dec(bookRows[0]._sum.credit)) : ZERO;
  return {
    bankAccount: { id: bankAccount.id, name: bankAccount.name, accountNumber },
    date,
    bankBalance: toMoneyString(bankBalance),
    bookBalance: toMoneyString(book),
    difference: toMoneyString(book.minus(bankBalance)),
    missingEntries: missing.map((m) => ({ id: m.id, date: toIsoDate(m.date), label: m.label, amount: toMoneyString(m.amount) })),
    manualEntries: otherEntries.map((l) => ({ entryId: l.entry.id, date: toIsoDate(l.entry.date), number: l.entry.entryNumber, label: l.entry.label, amount: toMoneyString(dec(l.debit).minus(dec(l.credit))), draft: l.entry.status === "DRAFT" })),
  };
}
