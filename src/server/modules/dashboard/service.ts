import { Prisma, type Company } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { dec, roundMoney, toMoneyString, vatShareOfPayment, ZERO } from "@/lib/money";
import {
  addDays,
  addMonths,
  diffInDays,
  endOfMonth,
  formatIsoForHumans,
  fromIsoDate,
  monthKey,
  startOfMonth,
  toIsoDate,
  todayInParis,
  type IsoDate,
} from "@/lib/dates";
import { fiscalYearBounds } from "@/server/modules/companies/fiscal-year";
import { resolveDateRange, type DateRange } from "@/server/modules/dashboard/periods";
import { currentVatPeriod, nextVatDeadline } from "@/server/modules/dashboard/vat-deadlines";

/**
 * Tableau de bord : tous les indicateurs sont calculés à partir des données
 * de l'entreprise (factures, règlements, achats, opérations bancaires).
 * Aucun chiffre n'est simulé : une entreprise sans données affiche des zéros.
 *
 * Définitions retenues (à faire valider par un professionnel du chiffre) :
 *  - Chiffre d'affaires : total HT des factures émises (hors brouillons et
 *    annulées) à leur date d'émission, diminué des avoirs.
 *  - Dépenses : total HT des achats saisis + décaissements bancaires non
 *    rattachés à un achat (hors virements internes et impôts), nets de TVA
 *    lorsqu'elle est renseignée.
 *  - TVA estimée : TVA collectée (à la facturation ou à l'encaissement selon
 *    l'exigibilité de chaque facture) moins la TVA déductible saisie.
 */

const ISSUED_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID"] as const;
const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;

export type DashboardAlert = {
  id: string;
  level: "danger" | "warning" | "info";
  title: string;
  description: string;
  dueDate?: IsoDate;
};

export type DashboardData = {
  generatedAt: string;
  today: IsoDate;
  currency: string;
  range: DateRange;
  fiscalYear: { label: string; from: IsoDate; to: IsoDate };
  vatApplicable: boolean;
  kpis: {
    revenueMonth: string;
    revenueFiscalYear: string;
    periodRevenue: string;
    periodExpenses: string;
    periodResult: string;
    periodVat: { collected: string; deductible: string; net: string } | null;
    bankBalance: string;
    bankAccountCount: number;
    availableCash: string;
    vatProvision: string;
    supplierDebt: string;
    unpaid: { count: number; amount: string };
    overdue: { count: number; amount: string };
  };
  monthly: Array<{ month: string; revenue: string; expenses: string }>;
  expensesByCategory: Array<{ name: string; color: string | null; amount: string }>;
  latestTransactions: Array<{
    id: string;
    date: IsoDate;
    label: string;
    amount: string;
    accountName: string;
    categoryName: string | null;
    status: string;
  }>;
  alerts: DashboardAlert[];
  isEmpty: boolean;
};

type SumRow = { total: Prisma.Decimal | null };
type TypedSumRow = { type: string; total: Prisma.Decimal | null };
type MonthSumRow = { month: string; total: Prisma.Decimal | null };
type CountSumRow = { count: bigint; total: Prisma.Decimal | null };

const issuedStatusesSql = Prisma.join([...ISSUED_STATUSES]);
const openStatusesSql = Prisma.join([...OPEN_STATUSES]);

/** Les avoirs viennent en déduction. */
function netOfCreditNotes(rows: TypedSumRow[]): Decimal {
  return rows.reduce((acc, row) => (row.type === "CREDIT_NOTE" ? acc.minus(dec(row.total)) : acc.plus(dec(row.total))), ZERO);
}

async function revenueBetween(companyId: string, from: IsoDate, to: IsoDate): Promise<Decimal> {
  const rows = await prisma.$queryRaw<TypedSumRow[]>`
    SELECT type, SUM(totalExclTax) AS total
    FROM invoices
    WHERE companyId = ${companyId} AND status IN (${issuedStatusesSql}) AND issueDate BETWEEN ${from} AND ${to}
    GROUP BY type`;
  return netOfCreditNotes(rows);
}

/** Décaissements bancaires comptés en dépenses : non rattachés à un achat, hors virements internes et impôts. */
const bankExpenseFilter = Prisma.sql`
  t.amount < 0 AND t.purchaseId IS NULL AND (t.categoryId IS NULL OR c.kind IN ('EXPENSE', 'PAYROLL'))`;

async function expensesBetween(companyId: string, from: IsoDate, to: IsoDate): Promise<Decimal> {
  const [purchases, bank] = await Promise.all([
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(totalExclTax) AS total FROM purchases
      WHERE companyId = ${companyId} AND status IN ('TO_PAY', 'PAID') AND issueDate BETWEEN ${from} AND ${to}`,
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(-t.amount - COALESCE(t.vatAmount, 0)) AS total
      FROM bank_transactions t LEFT JOIN transaction_categories c ON c.id = t.categoryId
      WHERE t.companyId = ${companyId} AND ${bankExpenseFilter} AND t.\`date\` BETWEEN ${from} AND ${to}`,
  ]);
  return dec(purchases[0]?.total).plus(dec(bank[0]?.total));
}

async function monthlySeries(companyId: string, from: IsoDate, to: IsoDate) {
  const [revenueRows, purchaseRows, bankRows] = await Promise.all([
    prisma.$queryRaw<Array<MonthSumRow & { type: string }>>`
      SELECT DATE_FORMAT(issueDate, '%Y-%m') AS month, type, SUM(totalExclTax) AS total
      FROM invoices
      WHERE companyId = ${companyId} AND status IN (${issuedStatusesSql}) AND issueDate BETWEEN ${from} AND ${to}
      GROUP BY month, type`,
    prisma.$queryRaw<MonthSumRow[]>`
      SELECT DATE_FORMAT(issueDate, '%Y-%m') AS month, SUM(totalExclTax) AS total
      FROM purchases
      WHERE companyId = ${companyId} AND status IN ('TO_PAY', 'PAID') AND issueDate BETWEEN ${from} AND ${to}
      GROUP BY month`,
    prisma.$queryRaw<MonthSumRow[]>`
      SELECT DATE_FORMAT(t.\`date\`, '%Y-%m') AS month, SUM(-t.amount - COALESCE(t.vatAmount, 0)) AS total
      FROM bank_transactions t LEFT JOIN transaction_categories c ON c.id = t.categoryId
      WHERE t.companyId = ${companyId} AND ${bankExpenseFilter} AND t.\`date\` BETWEEN ${from} AND ${to}
      GROUP BY month`,
  ]);

  const revenue = new Map<string, Decimal>();
  for (const row of revenueRows) {
    const current = revenue.get(row.month) ?? ZERO;
    revenue.set(row.month, row.type === "CREDIT_NOTE" ? current.minus(dec(row.total)) : current.plus(dec(row.total)));
  }
  const expenses = new Map<string, Decimal>();
  for (const row of [...purchaseRows, ...bankRows]) {
    expenses.set(row.month, (expenses.get(row.month) ?? ZERO).plus(dec(row.total)));
  }

  const series: DashboardData["monthly"] = [];
  for (let cursor = startOfMonth(from); cursor <= to; cursor = addMonths(cursor, 1)) {
    const key = monthKey(cursor);
    series.push({ month: key, revenue: toMoneyString(revenue.get(key)), expenses: toMoneyString(expenses.get(key)) });
  }
  return series;
}

async function expensesByCategory(companyId: string, from: IsoDate, to: IsoDate) {
  type Row = { name: string | null; color: string | null; total: Prisma.Decimal | null };
  const [purchaseRows, bankRows] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT c.name AS name, c.color AS color, SUM(p.totalExclTax) AS total
      FROM purchases p LEFT JOIN transaction_categories c ON c.id = p.categoryId
      WHERE p.companyId = ${companyId} AND p.status IN ('TO_PAY', 'PAID') AND p.issueDate BETWEEN ${from} AND ${to}
      GROUP BY c.id, c.name, c.color`,
    prisma.$queryRaw<Row[]>`
      SELECT c.name AS name, c.color AS color, SUM(-t.amount - COALESCE(t.vatAmount, 0)) AS total
      FROM bank_transactions t LEFT JOIN transaction_categories c ON c.id = t.categoryId
      WHERE t.companyId = ${companyId} AND ${bankExpenseFilter} AND t.\`date\` BETWEEN ${from} AND ${to}
      GROUP BY c.id, c.name, c.color`,
  ]);
  const merged = new Map<string, { color: string | null; amount: Decimal }>();
  for (const row of [...purchaseRows, ...bankRows]) {
    const name = row.name ?? "Non catégorisé";
    const current = merged.get(name) ?? { color: row.color, amount: ZERO };
    merged.set(name, { color: current.color ?? row.color, amount: current.amount.plus(dec(row.total)) });
  }
  return [...merged.entries()]
    .filter(([, value]) => value.amount.greaterThan(0))
    .sort((a, b) => b[1].amount.comparedTo(a[1].amount))
    .map(([name, value]) => ({ name, color: value.color, amount: toMoneyString(value.amount) }));
}

/** Estimation de la TVA sur une période (voir définitions en tête de fichier). */
export async function estimateVat(companyId: string, from: IsoDate, to: IsoDate) {
  const db = tenantDb(companyId);
  const [onDebits, creditNotesOnPayments, payments, purchases, bank] = await Promise.all([
    // TVA exigible à la facturation.
    prisma.$queryRaw<TypedSumRow[]>`
      SELECT type, SUM(totalVat) AS total FROM invoices
      WHERE companyId = ${companyId} AND status IN (${issuedStatusesSql}) AND vatExigibility = 'DEBITS'
        AND issueDate BETWEEN ${from} AND ${to}
      GROUP BY type`,
    // Avoirs sur factures à l'encaissement : déduits à leur date d'émission.
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(totalVat) AS total FROM invoices
      WHERE companyId = ${companyId} AND status IN (${issuedStatusesSql}) AND vatExigibility = 'ENCAISSEMENTS'
        AND type = 'CREDIT_NOTE' AND issueDate BETWEEN ${from} AND ${to}`,
    // TVA exigible à l'encaissement : prorata de chaque règlement.
    db.payment.findMany({
      where: {
        paidAt: { gte: fromIsoDate(from), lte: fromIsoDate(to) },
        invoice: { vatExigibility: "ENCAISSEMENTS", type: { in: ["INVOICE", "DEPOSIT"] } },
      },
      select: { amount: true, invoice: { select: { totalVat: true, totalInclTax: true } } },
    }),
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(totalVat) AS total FROM purchases
      WHERE companyId = ${companyId} AND status IN ('TO_PAY', 'PAID') AND issueDate BETWEEN ${from} AND ${to}`,
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(vatAmount) AS total FROM bank_transactions
      WHERE companyId = ${companyId} AND amount < 0 AND purchaseId IS NULL AND \`date\` BETWEEN ${from} AND ${to}`,
  ]);

  const collectedOnPayments = payments.reduce(
    (acc, p) => acc.plus(vatShareOfPayment(p.amount, p.invoice.totalVat, p.invoice.totalInclTax)),
    ZERO,
  );
  const collected = roundMoney(netOfCreditNotes(onDebits).plus(collectedOnPayments).minus(dec(creditNotesOnPayments[0]?.total)));
  const deductible = roundMoney(dec(purchases[0]?.total).plus(dec(bank[0]?.total)));
  return { collected, deductible, net: collected.minus(deductible) };
}

async function receivables(companyId: string, today: IsoDate) {
  const [unpaid, overdue] = await Promise.all([
    prisma.$queryRaw<CountSumRow[]>`
      SELECT COUNT(*) AS count, SUM(totalInclTax - amountPaid) AS total FROM invoices
      WHERE companyId = ${companyId} AND type IN ('INVOICE', 'DEPOSIT') AND status IN (${openStatusesSql})`,
    prisma.$queryRaw<CountSumRow[]>`
      SELECT COUNT(*) AS count, SUM(totalInclTax - amountPaid) AS total FROM invoices
      WHERE companyId = ${companyId} AND type IN ('INVOICE', 'DEPOSIT') AND status IN (${openStatusesSql})
        AND dueDate IS NOT NULL AND dueDate < ${today}`,
  ]);
  return {
    unpaid: { count: Number(unpaid[0]?.count ?? 0), amount: toMoneyString(unpaid[0]?.total) },
    overdue: { count: Number(overdue[0]?.count ?? 0), amount: toMoneyString(overdue[0]?.total) },
  };
}

async function bankPosition(companyId: string) {
  const [accounts, movements] = await Promise.all([
    prisma.$queryRaw<CountSumRow[]>`
      SELECT COUNT(*) AS count, SUM(openingBalance) AS total FROM bank_accounts
      WHERE companyId = ${companyId} AND isActive = TRUE`,
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(t.amount) AS total FROM bank_transactions t
      INNER JOIN bank_accounts a ON a.id = t.bankAccountId
      WHERE t.companyId = ${companyId} AND a.isActive = TRUE`,
  ]);
  return {
    accountCount: Number(accounts[0]?.count ?? 0),
    balance: dec(accounts[0]?.total).plus(dec(movements[0]?.total)),
  };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export async function getDashboard(
  company: Pick<Company, "id" | "currency" | "vatRegime" | "fiscalYearStartMonth">,
  filter: { preset?: string | null; from?: string | null; to?: string | null } = {},
  now: Date = new Date(),
): Promise<DashboardData> {
  const companyId = company.id;
  const db = tenantDb(companyId);
  const today = todayInParis(now);
  const range = resolveDateRange(filter, today);

  const storedFiscalYear = await db.fiscalYear.findFirst({
    where: { startDate: { lte: fromIsoDate(today) }, endDate: { gte: fromIsoDate(today) } },
  });
  const fallback = fiscalYearBounds(company.fiscalYearStartMonth, today);
  const fiscalYear = storedFiscalYear
    ? { label: storedFiscalYear.label, from: toIsoDate(storedFiscalYear.startDate), to: toIsoDate(storedFiscalYear.endDate) }
    : { label: fallback.label, from: fallback.startDate, to: fallback.endDate };

  const vatApplicable = company.vatRegime !== "FRANCHISE";
  const vatPeriod = currentVatPeriod(company.vatRegime, fiscalYear, today);
  const seriesFrom = startOfMonth(addMonths(today, -11));
  const seriesTo = endOfMonth(today);
  const soon = addDays(today, 7);

  const [
    revenueMonth,
    revenueFiscalYear,
    periodRevenue,
    periodExpenses,
    periodVat,
    provisionVat,
    bank,
    due,
    supplierDebtRows,
    monthly,
    categories,
    latest,
    toReviewCount,
    unjustifiedRows,
    dueSoonRows,
    purchasesDueSoonRows,
    activityRows,
  ] = await Promise.all([
    revenueBetween(companyId, startOfMonth(today), endOfMonth(today)),
    revenueBetween(companyId, fiscalYear.from, fiscalYear.to),
    revenueBetween(companyId, range.from, range.to),
    expensesBetween(companyId, range.from, range.to),
    vatApplicable ? estimateVat(companyId, range.from, range.to) : null,
    vatPeriod ? estimateVat(companyId, vatPeriod.from, vatPeriod.to) : null,
    bankPosition(companyId),
    receivables(companyId, today),
    prisma.$queryRaw<SumRow[]>`
      SELECT SUM(totalInclTax - amountPaid) AS total FROM purchases
      WHERE companyId = ${companyId} AND status = 'TO_PAY'`,
    monthlySeries(companyId, seriesFrom, seriesTo),
    expensesByCategory(companyId, range.from, range.to),
    db.bankTransaction.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { category: { select: { name: true } }, bankAccount: { select: { name: true } } },
    }),
    db.bankTransaction.count({ where: { status: "TO_REVIEW" } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM bank_transactions t
      WHERE t.companyId = ${companyId} AND t.amount < 0
        AND NOT EXISTS (
          SELECT 1 FROM document_links l
          WHERE l.companyId = t.companyId AND l.entityType = 'BANK_TRANSACTION' AND l.entityId = t.id
        )`,
    prisma.$queryRaw<CountSumRow[]>`
      SELECT COUNT(*) AS count, SUM(totalInclTax - amountPaid) AS total FROM invoices
      WHERE companyId = ${companyId} AND type IN ('INVOICE', 'DEPOSIT') AND status IN (${openStatusesSql})
        AND dueDate BETWEEN ${today} AND ${soon}`,
    prisma.$queryRaw<CountSumRow[]>`
      SELECT COUNT(*) AS count, SUM(totalInclTax - amountPaid) AS total FROM purchases
      WHERE companyId = ${companyId} AND status = 'TO_PAY' AND dueDate IS NOT NULL AND dueDate <= ${soon}`,
    prisma.$queryRaw<Array<{ invoices: bigint; purchases: bigint; transactions: bigint }>>`
      SELECT
        (SELECT COUNT(*) FROM invoices WHERE companyId = ${companyId}) AS invoices,
        (SELECT COUNT(*) FROM purchases WHERE companyId = ${companyId}) AS purchases,
        (SELECT COUNT(*) FROM bank_transactions WHERE companyId = ${companyId}) AS transactions`,
  ]);

  const vatProvision = provisionVat && provisionVat.net.greaterThan(0) ? provisionVat.net : ZERO;
  const supplierDebt = dec(supplierDebtRows[0]?.total);
  const availableCash = bank.balance.minus(vatProvision).minus(supplierDebt);

  // --- Alertes et échéances --------------------------------------------------
  const alerts: DashboardAlert[] = [];
  const money = (value: string) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: company.currency }).format(value as unknown as number);

  if (due.overdue.count > 0) {
    alerts.push({
      id: "invoices-overdue",
      level: "danger",
      title: `${plural(due.overdue.count, "facture en retard", "factures en retard")} de paiement`,
      description: `${money(due.overdue.amount)} restent à encaisser sur des factures échues. Pensez à relancer vos clients.`,
    });
  }
  const dueSoonCount = Number(dueSoonRows[0]?.count ?? 0);
  if (dueSoonCount > 0) {
    alerts.push({
      id: "invoices-due-soon",
      level: "info",
      title: `${plural(dueSoonCount, "facture arrive", "factures arrivent")} à échéance sous 7 jours`,
      description: `${money(toMoneyString(dueSoonRows[0]?.total))} attendus d'ici le ${formatIsoForHumans(soon)}.`,
      dueDate: soon,
    });
  }
  const purchasesDueCount = Number(purchasesDueSoonRows[0]?.count ?? 0);
  if (purchasesDueCount > 0) {
    alerts.push({
      id: "purchases-due",
      level: "warning",
      title: `${plural(purchasesDueCount, "facture fournisseur", "factures fournisseurs")} à régler`,
      description: `${money(toMoneyString(purchasesDueSoonRows[0]?.total))} à payer d'ici le ${formatIsoForHumans(soon)} (échéances dépassées incluses).`,
      dueDate: soon,
    });
  }
  const vatDeadline = nextVatDeadline(company.vatRegime, company.fiscalYearStartMonth, today);
  if (vatDeadline && diffInDays(today, vatDeadline.windowEnd) <= 45) {
    alerts.push({
      id: "vat-deadline",
      level: diffInDays(today, vatDeadline.windowEnd) <= 10 ? "warning" : "info",
      title: vatDeadline.title,
      description: vatDeadline.description,
      dueDate: vatDeadline.windowEnd,
    });
  }
  const daysToClosing = diffInDays(today, fiscalYear.to);
  if (daysToClosing >= 0 && daysToClosing <= 60) {
    alerts.push({
      id: "fiscal-year-closing",
      level: "info",
      title: `Clôture de l'exercice dans ${plural(daysToClosing, "jour", "jours")}`,
      description: `${fiscalYear.label} se termine le ${formatIsoForHumans(fiscalYear.to)}. Vérifiez que vos pièces et rapprochements sont à jour.`,
      dueDate: fiscalYear.to,
    });
  }
  if (toReviewCount > 0) {
    alerts.push({
      id: "transactions-to-review",
      level: "warning",
      title: `${plural(toReviewCount, "opération bancaire", "opérations bancaires")} à catégoriser`,
      description: "Catégorisez ces opérations pour fiabiliser vos indicateurs et votre comptabilité.",
    });
  }
  const unjustifiedCount = Number(unjustifiedRows[0]?.count ?? 0);
  if (unjustifiedCount > 0) {
    alerts.push({
      id: "transactions-unjustified",
      level: "info",
      title: `${plural(unjustifiedCount, "dépense", "dépenses")} sans justificatif`,
      description: "Associez une facture ou un reçu à chaque décaissement pour sécuriser vos déductions.",
    });
  }

  const activity = activityRows[0];
  const isEmpty =
    Number(activity?.invoices ?? 0) + Number(activity?.purchases ?? 0) + Number(activity?.transactions ?? 0) === 0;

  return {
    generatedAt: now.toISOString(),
    today,
    currency: company.currency,
    range,
    fiscalYear,
    vatApplicable,
    kpis: {
      revenueMonth: toMoneyString(revenueMonth),
      revenueFiscalYear: toMoneyString(revenueFiscalYear),
      periodRevenue: toMoneyString(periodRevenue),
      periodExpenses: toMoneyString(periodExpenses),
      periodResult: toMoneyString(periodRevenue.minus(periodExpenses)),
      periodVat: periodVat
        ? {
            collected: toMoneyString(periodVat.collected),
            deductible: toMoneyString(periodVat.deductible),
            net: toMoneyString(periodVat.net),
          }
        : null,
      bankBalance: toMoneyString(bank.balance),
      bankAccountCount: bank.accountCount,
      availableCash: toMoneyString(availableCash),
      vatProvision: toMoneyString(vatProvision),
      supplierDebt: toMoneyString(supplierDebt),
      unpaid: due.unpaid,
      overdue: due.overdue,
    },
    monthly,
    expensesByCategory: categories,
    latestTransactions: latest.map((t) => ({
      id: t.id,
      date: toIsoDate(t.date),
      label: t.label,
      amount: toMoneyString(t.amount),
      accountName: t.bankAccount.name,
      categoryName: t.category?.name ?? null,
      status: t.status,
    })),
    alerts,
    isEmpty,
  };
}
