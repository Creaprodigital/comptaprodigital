import type { FiscalYear, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { ACCOUNTS } from "@/config/chart-of-accounts";
import { dec, toMoneyString, ZERO } from "@/lib/money";
import { addDays, formatIsoForHumans, fromIsoDate, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";
import { pendingDepreciations } from "./assets";
import { insertEntry, lockCompany, type LineInput } from "./entries";
import { fiscalYearFor } from "./fiscal-years";
import { resyncAll } from "./sync";

/**
 * Verrouillage des périodes et clôture des exercices.
 *
 *  - Le **verrouillage** interdit toute écriture jusqu'à une date : il suppose que
 *    le brouillard de la période soit entièrement validé. Il ne peut qu'avancer.
 *  - La **clôture** est définitive : elle vérifie que tout est validé et que les
 *    dotations aux amortissements sont comptabilisées, reporte les soldes des
 *    comptes de bilan (classes 1 à 5) dans l'exercice suivant par une écriture
 *    d'à-nouveaux, et y inscrit le résultat (compte 120 ou 129) en attente
 *    d'affectation par l'assemblée ou l'exploitant.
 */

export type FiscalYearView = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: FiscalYear["status"];
  lockedThrough: string | null;
  closedAt: string | null;
  entryCount: number;
  draftCount: number;
};

export async function listFiscalYears(access: CompanyAccess): Promise<FiscalYearView[]> {
  const years = await access.db.fiscalYear.findMany({ orderBy: { startDate: "desc" } });
  const counts = await access.db.accountingEntry.groupBy({ by: ["fiscalYearId", "status"], _count: { _all: true } });
  return years.map((y) => ({
    id: y.id,
    label: y.label,
    startDate: toIsoDate(y.startDate),
    endDate: toIsoDate(y.endDate),
    status: y.status,
    lockedThrough: y.lockedThrough ? toIsoDate(y.lockedThrough) : null,
    closedAt: y.closedAt?.toISOString() ?? null,
    entryCount: counts.filter((c) => c.fiscalYearId === y.id).reduce((acc, c) => acc + c._count._all, 0),
    draftCount: counts.find((c) => c.fiscalYearId === y.id && c.status === "DRAFT")?._count._all ?? 0,
  }));
}

/** Crée l'exercice suivant le dernier exercice existant. */
export async function createNextFiscalYear(access: CompanyAccess, userId: string, meta: Meta = {}): Promise<FiscalYearView> {
  const last = await access.db.fiscalYear.findFirst({ orderBy: { startDate: "desc" } });
  if (!last) throw errors.notFound("Aucun exercice comptable.");
  const created = await prisma.$transaction(async (tx) => {
    const year = await fiscalYearFor(tx, access.company, addDays(toIsoDate(last.endDate), 1));
    await recordAudit({ action: "fiscal_year.create", userId, companyId: access.company.id, entityType: "FiscalYear", entityId: year.id, metadata: { label: year.label }, ...meta }, tx);
    return year;
  });
  return (await listFiscalYears(access)).find((y) => y.id === created.id)!;
}

async function findYear(access: CompanyAccess, fiscalYearId: string) {
  const year = await access.db.fiscalYear.findFirst({ where: { id: fiscalYearId } });
  if (!year) throw errors.notFound("Exercice introuvable.");
  return year;
}

/** Verrouille un exercice jusqu'à une date incluse (fin de mois, de trimestre…). */
export async function lockPeriod(access: CompanyAccess, userId: string, fiscalYearId: string, through: IsoDate, meta: Meta = {}): Promise<FiscalYearView> {
  const companyId = access.company.id;
  await resyncAll(access.company);
  await prisma.$transaction(async (tx) => {
    await lockCompany(tx, companyId);
    const year = await tx.fiscalYear.findFirstOrThrow({ where: { id: fiscalYearId, companyId } });
    if (year.status === "CLOSED") throw errors.conflict("FISCAL_YEAR_CLOSED", "Cet exercice est clôturé.");
    if (through < toIsoDate(year.startDate) || through > toIsoDate(year.endDate)) throw errors.validation([{ path: "through", message: "La date doit appartenir à l'exercice" }]);
    if (year.lockedThrough && through <= toIsoDate(year.lockedThrough)) throw errors.validation([{ path: "through", message: `La période est déjà verrouillée jusqu'au ${formatIsoForHumans(toIsoDate(year.lockedThrough))}` }]);
    const drafts = await tx.accountingEntry.count({ where: { companyId, fiscalYearId, status: "DRAFT", date: { lte: fromIsoDate(through) } } });
    if (drafts > 0) throw errors.conflict("DRAFTS_REMAINING", `${drafts} écriture${drafts > 1 ? "s" : ""} du brouillard ${drafts > 1 ? "sont datées" : "est datée"} de cette période : validez-les avant de verrouiller.`);
    await tx.fiscalYear.update({ where: { id: fiscalYearId }, data: { lockedThrough: fromIsoDate(through) } });
    await recordAudit({ action: "fiscal_year.lock", userId, companyId, entityType: "FiscalYear", entityId: fiscalYearId, metadata: { detail: `Période verrouillée jusqu'au ${formatIsoForHumans(through)}` }, ...meta }, tx);
  });
  return (await listFiscalYears(access)).find((y) => y.id === fiscalYearId)!;
}

export type ClosingCheck = { ready: boolean; problems: string[]; result: string | null };

/** Contrôles préalables à la clôture. */
export async function closingCheck(access: CompanyAccess, fiscalYearId: string): Promise<ClosingCheck> {
  const year = await findYear(access, fiscalYearId);
  const problems: string[] = [];
  if (year.status === "CLOSED") return { ready: false, problems: ["Cet exercice est déjà clôturé."], result: null };
  if (toIsoDate(year.endDate) >= todayInParis()) problems.push(`L'exercice se termine le ${formatIsoForHumans(toIsoDate(year.endDate))} : il ne peut être clôturé qu'après cette date.`);
  const previousOpen = await access.db.fiscalYear.findFirst({ where: { startDate: { lt: year.startDate }, status: "OPEN" } });
  if (previousOpen) problems.push(`L'exercice précédent (${previousOpen.label}) doit être clôturé d'abord.`);
  const drafts = await access.db.accountingEntry.count({ where: { fiscalYearId, status: "DRAFT" } });
  if (drafts > 0) problems.push(`${drafts} écriture${drafts > 1 ? "s" : ""} au brouillard à valider ou supprimer.`);
  const pending = await pendingDepreciations(access, fiscalYearId);
  if (pending.length > 0) problems.push(`Dotations aux amortissements à calculer pour ${pending.length} bien${pending.length > 1 ? "s" : ""}.`);
  const suspense = await access.db.accountingEntryLine.aggregate({ where: { account: { number: ACCOUNTS.suspense }, entry: { fiscalYearId } }, _sum: { debit: true, credit: true } });
  const suspenseBalance = dec(suspense._sum.debit).minus(dec(suspense._sum.credit));
  if (!suspenseBalance.isZero()) problems.push(`Le compte d'attente 471000 présente un solde de ${suspenseBalance.toFixed(2).replace(".", ",")} € : reclassez les opérations concernées.`);
  const totals = await access.db.accountingEntryLine.aggregate({ where: { entry: { fiscalYearId } }, _sum: { debit: true, credit: true } });
  if (!dec(totals._sum.debit).equals(dec(totals._sum.credit))) problems.push("Les totaux des débits et des crédits de l'exercice ne sont pas égaux.");
  const result = await resultOf(prisma, access.company.id, fiscalYearId);
  return { ready: problems.length === 0, problems, result: toMoneyString(result) };
}

async function resultOf(tx: Prisma.TransactionClient | typeof prisma, companyId: string, fiscalYearId: string) {
  const rows = await tx.$queryRaw<Array<{ cls: string; balance: Prisma.Decimal | null }>>`
    SELECT LEFT(a.number, 1) AS cls, SUM(l.credit - l.debit) AS balance
    FROM accounting_entry_lines l
    INNER JOIN accounting_entries e ON e.id = l.entryId
    INNER JOIN accounting_accounts a ON a.id = l.accountId
    WHERE l.companyId = ${companyId} AND e.fiscalYearId = ${fiscalYearId} AND LEFT(a.number, 1) IN ('6', '7')
    GROUP BY LEFT(a.number, 1)`;
  return rows.reduce((acc, r) => acc.plus(dec(r.balance)), ZERO);
}

/** Clôture définitive d'un exercice et ouverture de l'exercice suivant (à-nouveaux). */
export async function closeFiscalYear(access: CompanyAccess, userId: string, fiscalYearId: string, meta: Meta = {}): Promise<{ result: string; openingEntryId: string | null }> {
  const companyId = access.company.id;
  await resyncAll(access.company);
  const check = await closingCheck(access, fiscalYearId);
  if (!check.ready) throw errors.conflict("CLOSING_NOT_READY", check.problems.join(" "));

  return prisma.$transaction(
    async (tx) => {
      await lockCompany(tx, companyId);
      const year = await tx.fiscalYear.findFirstOrThrow({ where: { id: fiscalYearId, companyId } });
      if (year.status === "CLOSED") throw errors.conflict("FISCAL_YEAR_CLOSED", "Cet exercice est déjà clôturé.");
      if ((await tx.accountingEntry.count({ where: { companyId, fiscalYearId, status: "DRAFT" } })) > 0) throw errors.conflict("DRAFTS_REMAINING", "Des écritures du brouillard sont apparues : validez-les avant de clôturer.");
      const result = await resultOf(tx, companyId, fiscalYearId);

      // Soldes des comptes de bilan, par compte et par tiers.
      const balances = await tx.$queryRaw<Array<{ number: string; aux: string | null; auxLabel: string | null; balance: Prisma.Decimal }>>`
        SELECT a.number AS number, l.auxiliaryNumber AS aux, MAX(l.auxiliaryLabel) AS auxLabel, SUM(l.debit - l.credit) AS balance
        FROM accounting_entry_lines l
        INNER JOIN accounting_entries e ON e.id = l.entryId
        INNER JOIN accounting_accounts a ON a.id = l.accountId
        WHERE l.companyId = ${companyId} AND e.fiscalYearId = ${fiscalYearId} AND LEFT(a.number, 1) IN ('1', '2', '3', '4', '5')
        GROUP BY a.number, l.auxiliaryNumber
        HAVING SUM(l.debit - l.credit) <> 0
        ORDER BY a.number, l.auxiliaryNumber`;
      const nextStart = addDays(toIsoDate(year.endDate), 1);
      const next = await fiscalYearFor(tx, access.company, nextStart);
      const label = `À-nouveaux — ouverture de l'${next.label.toLowerCase()}`;
      const lines: LineInput[] = balances.map((b) => {
        const balance = dec(b.balance);
        return { accountNumber: b.number, label, debit: balance.isPositive() ? balance.toFixed(2) : "0", credit: balance.isNegative() ? balance.negated().toFixed(2) : "0", auxiliaryNumber: b.aux, auxiliaryLabel: b.auxLabel };
      });
      if (!result.isZero()) {
        lines.push(
          result.isPositive()
            ? { accountNumber: ACCOUNTS.profit, label: `Résultat de l'${year.label.toLowerCase()} (bénéfice)`, debit: "0", credit: result.toFixed(2) }
            : { accountNumber: ACCOUNTS.loss, label: `Résultat de l'${year.label.toLowerCase()} (perte)`, debit: result.negated().toFixed(2), credit: "0" },
        );
      }
      let openingEntryId: string | null = null;
      if (lines.length >= 2) {
        const entry = await insertEntry(tx, access.company, { journalCode: "AN", date: nextStart, label, pieceRef: `AN-${nextStart.slice(0, 4)}`, pieceDate: nextStart, lines }, { status: "DRAFT", sourceType: "CLOSING", sourceId: fiscalYearId, createdById: userId });
        // Les à-nouveaux reprennent des soldes validés : l'écriture est validée immédiatement.
        const max = await tx.accountingEntry.aggregate({ where: { fiscalYearId: next.id }, _max: { entryNumber: true } });
        await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: "VALIDATED", entryNumber: (max._max.entryNumber ?? 0) + 1, validatedAt: new Date(), validatedById: userId } });
        openingEntryId = entry.id;
      }
      await tx.fiscalYear.update({ where: { id: fiscalYearId }, data: { status: "CLOSED", lockedThrough: year.endDate, closedAt: new Date(), closedById: userId } });
      await recordAudit(
        { action: "fiscal_year.close", userId, companyId, entityType: "FiscalYear", entityId: fiscalYearId, metadata: { detail: `Exercice clôturé — résultat ${result.toFixed(2).replace(".", ",")} €`, result: result.toFixed(2), openingEntryId }, ...meta },
        tx,
      );
      return { result: toMoneyString(result), openingEntryId };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}
