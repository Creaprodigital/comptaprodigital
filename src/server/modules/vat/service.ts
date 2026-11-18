import type { Company, Prisma, VatPeriod } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { documentHistory, type HistoryEntry, type Meta } from "@/server/modules/invoicing/shared";
import { nextVatDeadline, secondWorkingDayAfterMayFirst, type VatDeadline } from "@/server/modules/dashboard/vat-deadlines";
import { syncAccountingFor } from "@/server/modules/accounting/sync";
import { dec, toMoneyString, ZERO } from "@/lib/money";
import { addDays, addMonths, endOfMonth, formatIsoForHumans, fromIsoDate, monthName, startOfMonth, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";
import { computeVat, VAT_OPERATION_LABELS, type VatComputation } from "./compute";

/**
 * Déclarations de TVA : périodes selon le régime, préparation (calcul et
 * instantané), validation par l'utilisateur, puis indication du dépôt.
 *
 * La plateforme ne transmet jamais de déclaration à l'administration : la
 * déclaration préparée est à reporter sur l'espace professionnel impots.gouv.fr
 * (ou à transmettre par un partenaire EDI habilité), après contrôle.
 */

export type VatPeriodBounds = { startDate: IsoDate; endDate: IsoDate; formType: "CA3" | "CA12" | "CA12E"; label: string };

/** Périodes de déclaration d'une année d'activité selon le régime. */
export function periodsBetween(company: Pick<Company, "vatRegime" | "fiscalYearStartMonth">, from: IsoDate, to: IsoDate): VatPeriodBounds[] {
  const periods: VatPeriodBounds[] = [];
  if (company.vatRegime === "FRANCHISE") return periods;
  if (company.vatRegime === "REEL_SIMPLIFIE") {
    const startMonth = company.fiscalYearStartMonth;
    const year = Number(from.slice(0, 4)) - 1;
    for (let y = year; y <= Number(to.slice(0, 4)) + 1; y++) {
      const start = `${y}-${String(startMonth).padStart(2, "0")}-01`;
      const end = addDays(addMonths(start, 12), -1);
      if (end < from || start > to) continue;
      const formType = startMonth === 1 ? "CA12" : "CA12E";
      periods.push({ startDate: start, endDate: end, formType, label: `Exercice ${start.slice(0, 4)}${start.slice(0, 4) === end.slice(0, 4) ? "" : `-${end.slice(0, 4)}`}` });
    }
    return periods;
  }
  const step = company.vatRegime === "REEL_NORMAL_MENSUEL" ? 1 : 3;
  let start = startOfMonth(from);
  if (step === 3) start = `${start.slice(0, 4)}-${String(Math.floor((Number(start.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  while (start <= to) {
    const end = endOfMonth(addMonths(start, step - 1));
    const month = Number(start.slice(5, 7));
    const label = step === 1 ? `${monthName(month)} ${start.slice(0, 4)}` : `${Math.floor((month - 1) / 3) + 1}${month === 1 ? "er" : "e"} trimestre ${start.slice(0, 4)}`;
    periods.push({ startDate: start, endDate: end, formType: "CA3", label: label.charAt(0).toUpperCase() + label.slice(1) });
    start = addMonths(start, step);
  }
  return periods;
}

/** Date limite indicative de dépôt (fenêtre légale ; la date exacte figure sur l'espace professionnel). */
export function depositDeadline(period: VatPeriodBounds): IsoDate {
  if (period.formType === "CA3") return `${addMonths(startOfMonth(period.endDate), 1).slice(0, 7)}-24`;
  if (period.formType === "CA12") return secondWorkingDayAfterMayFirst(Number(period.endDate.slice(0, 4)) + 1);
  return addMonths(period.endDate, 3);
}

export type VatPeriodView = VatPeriodBounds & {
  id: string | null;
  status: VatPeriod["status"] | "NOT_STARTED";
  dueDate: IsoDate;
  current: boolean;
  ended: boolean;
  collected: string;
  deductible: string;
  creditCarriedOver: string;
  netVatDue: string;
  /** Les opérations de la période ont changé depuis la préparation ou la validation. */
  outdated: boolean;
};

type Snapshot = { collected: Decimal; deductible: Decimal; deductibleAssets: Decimal; creditCarriedOver: Decimal; net: Decimal };

function snapshotOf(computation: VatComputation, creditCarriedOver: Decimal): Snapshot {
  const collected = dec(computation.collected);
  const deductible = dec(computation.deductibleGoodsServices);
  const deductibleAssets = dec(computation.deductibleAssets);
  return { collected, deductible, deductibleAssets, creditCarriedOver, net: collected.minus(deductible).minus(deductibleAssets).minus(creditCarriedOver) };
}

/** Crédit de TVA reporté de la déclaration précédente (validée), s'il y en a un. */
async function previousCredit(companyId: string, startDate: IsoDate): Promise<Decimal> {
  const previous = await prisma.vatPeriod.findFirst({ where: { companyId, endDate: fromIsoDate(addDays(startDate, -1)), status: { in: ["VALIDATED", "DECLARED"] } } });
  return previous && dec(previous.netVatDue).isNegative() ? dec(previous.netVatDue).negated() : ZERO;
}

async function firstActivityDate(companyId: string): Promise<IsoDate> {
  const year = await prisma.fiscalYear.findFirst({ where: { companyId }, orderBy: { startDate: "asc" } });
  return year ? toIsoDate(year.startDate) : todayInParis();
}

/** Périodes de l'année demandée (ou de l'année en cours), avec leurs montants. */
export async function listVatPeriods(access: CompanyAccess, year?: number) {
  const company = access.company;
  const today = todayInParis();
  const selectedYear = year ?? Number(today.slice(0, 4));
  if (company.vatRegime === "FRANCHISE") return { regime: company.vatRegime, year: selectedYear, periods: [] as VatPeriodView[], years: [] as number[] };
  const first = await firstActivityDate(company.id);
  const from = `${selectedYear}-01-01` < first ? first : `${selectedYear}-01-01`;
  const to = `${selectedYear}-12-31` > today ? today : `${selectedYear}-12-31`;
  const bounds = from <= to ? periodsBetween(company, from, to) : [];
  const stored = await access.db.vatPeriod.findMany({ where: { startDate: { in: bounds.map((b) => fromIsoDate(b.startDate)) } } });
  const periods: VatPeriodView[] = [];
  for (const b of bounds) {
    const row = stored.find((s) => toIsoDate(s.startDate) === b.startDate && toIsoDate(s.endDate) === b.endDate);
    const computation = await computeVat(company.id, b.startDate, b.endDate);
    const credit = row ? dec(row.creditCarriedOver) : await previousCredit(company.id, b.startDate);
    const live = snapshotOf(computation, credit);
    const outdated = Boolean(row && row.status !== "OPEN" && (!dec(row.collectedVat).equals(live.collected) || !dec(row.deductibleVat).equals(live.deductible) || !dec(row.deductibleVatAssets).equals(live.deductibleAssets)));
    const frozen = row && row.status !== "OPEN";
    periods.push({
      ...b,
      id: row?.id ?? null,
      status: row?.status ?? "NOT_STARTED",
      dueDate: depositDeadline(b),
      current: b.startDate <= today && today <= b.endDate,
      ended: b.endDate < today,
      collected: toMoneyString(frozen ? row.collectedVat : live.collected),
      deductible: toMoneyString(frozen ? dec(row.deductibleVat).plus(dec(row.deductibleVatAssets)) : live.deductible.plus(live.deductibleAssets)),
      creditCarriedOver: toMoneyString(frozen ? row.creditCarriedOver : credit),
      netVatDue: toMoneyString(frozen ? row.netVatDue : live.net),
      outdated,
    });
  }
  const firstYear = Number(first.slice(0, 4));
  const years = Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, i) => firstYear + i).reverse();
  return { regime: company.vatRegime, year: selectedYear, periods: periods.reverse(), years };
}

function boundsFor(company: Pick<Company, "vatRegime" | "fiscalYearStartMonth">, startDate: IsoDate): VatPeriodBounds {
  const bounds = periodsBetween(company, startDate, startDate).find((b) => b.startDate === startDate);
  if (!bounds) throw errors.notFound("Période de TVA introuvable.");
  return bounds;
}

export type VatPeriodDetail = {
  period: VatPeriodView;
  computation: VatComputation;
  /** Montants figés lors de la préparation ou de la validation. */
  snapshot: { collected: string; deductibleGoodsServices: string; deductibleAssets: string; creditCarriedOver: string; netVatDue: string; preparedAt: string | null; validatedAt: string | null; declaredAt: string | null } | null;
  /** Repères de la déclaration CA3 (à vérifier sur le formulaire en vigueur). */
  form: Array<{ line: string; label: string; base: string | null; amount: string }>;
  accountingCheck: { collected: string; deductible: string } | null;
  history: HistoryEntry[];
};

const CA3_RATE_LINES: Record<string, string> = { "20": "08", "10": "9B", "5.5": "09" };

export async function getVatPeriod(access: CompanyAccess, startDate: IsoDate): Promise<VatPeriodDetail> {
  const company = access.company;
  if (company.vatRegime === "FRANCHISE") throw errors.badRequest("VAT_FRANCHISE", "L'entreprise relève de la franchise en base de TVA : elle ne dépose pas de déclaration.");
  const bounds = boundsFor(company, startDate);
  const { periods } = await listVatPeriods(access, Number(bounds.endDate.slice(0, 4)));
  const view = periods.find((p) => p.startDate === bounds.startDate) ?? (await listVatPeriods(access, Number(bounds.startDate.slice(0, 4)))).periods.find((p) => p.startDate === bounds.startDate);
  if (!view) throw errors.notFound("Période de TVA introuvable.");
  const [computation, row] = await Promise.all([computeVat(company.id, bounds.startDate, bounds.endDate), access.db.vatPeriod.findFirst({ where: { startDate: fromIsoDate(bounds.startDate), endDate: fromIsoDate(bounds.endDate) } })]);
  const snapshot = row && row.status !== "OPEN"
    ? {
        collected: toMoneyString(row.collectedVat),
        deductibleGoodsServices: toMoneyString(row.deductibleVat),
        deductibleAssets: toMoneyString(row.deductibleVatAssets),
        creditCarriedOver: toMoneyString(row.creditCarriedOver),
        netVatDue: toMoneyString(row.netVatDue),
        preparedAt: row.updatedAt.toISOString(),
        validatedAt: row.validatedAt?.toISOString() ?? null,
        declaredAt: row.declaredAt?.toISOString() ?? null,
      }
    : null;
  const source = snapshot ?? { collected: computation.collected, deductibleGoodsServices: computation.deductibleGoodsServices, deductibleAssets: computation.deductibleAssets, creditCarriedOver: view.creditCarriedOver, netVatDue: view.netVatDue };
  const net = dec(source.netVatDue);
  const form: VatPeriodDetail["form"] = [];
  if (bounds.formType === "CA3") {
    const taxableBase = computation.collectedByRate.filter((r) => !dec(r.rate).isZero()).reduce((acc, r) => acc.plus(dec(r.base)), ZERO);
    form.push({ line: "A1", label: "Ventes, prestations de services (base hors taxe)", base: null, amount: toMoneyString(taxableBase) });
    for (const row of computation.collectedByRate.filter((r) => !dec(r.rate).isZero())) {
      const line = CA3_RATE_LINES[dec(row.rate).toString()];
      form.push({ line: line ?? "—", label: `Opérations imposables au taux de ${row.rate.replace(".", ",")} %`, base: row.base, amount: row.vat });
    }
    form.push(
      { line: "16", label: "Total de la TVA brute due", base: null, amount: source.collected },
      { line: "19", label: "TVA déductible sur immobilisations", base: null, amount: source.deductibleAssets },
      { line: "20", label: "TVA déductible sur autres biens et services", base: null, amount: source.deductibleGoodsServices },
      { line: "22", label: "Report du crédit de la déclaration précédente", base: null, amount: source.creditCarriedOver },
      { line: "23", label: "Total de la TVA déductible", base: null, amount: toMoneyString(dec(source.deductibleAssets).plus(dec(source.deductibleGoodsServices)).plus(dec(source.creditCarriedOver))) },
      net.isNegative() ? { line: "25", label: "Crédit de TVA", base: null, amount: toMoneyString(net.negated()) } : { line: "28", label: "TVA nette due", base: null, amount: toMoneyString(net) },
    );
  }
  // Contrôle de concordance avec la comptabilité (écritures validées et brouillard).
  let accountingCheck: VatPeriodDetail["accountingCheck"] = null;
  if (company.accountingMode === "DOUBLE_ENTRY") {
    const rows = await prisma.$queryRaw<Array<{ number: string; balance: Prisma.Decimal | null }>>`
      SELECT a.number AS number, SUM(l.credit - l.debit) AS balance
      FROM accounting_entry_lines l
      INNER JOIN accounting_entries e ON e.id = l.entryId
      INNER JOIN accounting_accounts a ON a.id = l.accountId
      WHERE l.companyId = ${company.id} AND COALESCE(e.pieceDate, e.date) BETWEEN ${bounds.startDate} AND ${bounds.endDate}
        AND a.number IN ('445710', '445660', '445620') AND e.sourceType <> 'VAT_RETURN'
      GROUP BY a.number`;
    if (rows.length > 0) {
      const get = (n: string) => dec(rows.find((r) => r.number === n)?.balance);
      accountingCheck = { collected: toMoneyString(get("445710")), deductible: toMoneyString(get("445660").plus(get("445620")).negated()) };
    }
  }
  const history = row ? await documentHistory(company.id, "VatPeriod", row.id) : [];
  return { period: view, computation, snapshot, form, accountingCheck, history };
}

/** Prépare, valide, marque comme déclarée ou rouvre une période. */
export async function vatPeriodAction(access: CompanyAccess, userId: string, startDate: IsoDate, action: "prepare" | "validate" | "declare" | "reopen", meta: Meta = {}): Promise<VatPeriodDetail> {
  const company = access.company;
  if (company.vatRegime === "FRANCHISE") throw errors.badRequest("VAT_FRANCHISE", "L'entreprise relève de la franchise en base de TVA.");
  const bounds = boundsFor(company, startDate);
  const today = todayInParis();
  const companyId = company.id;
  let periodId = "";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
    let row = await tx.vatPeriod.findFirst({ where: { companyId, startDate: fromIsoDate(bounds.startDate), endDate: fromIsoDate(bounds.endDate) } });
    const detail = (message: string) => recordAudit({ action: `vat.${action}`, userId, companyId, entityType: "VatPeriod", entityId: row!.id, metadata: { detail: message }, ...meta }, tx);

    if (action === "prepare" || action === "validate") {
      if (bounds.endDate >= today) throw errors.badRequest("PERIOD_NOT_ENDED", `La période se termine le ${formatIsoForHumans(bounds.endDate)} : elle ne peut être déclarée qu'ensuite.`);
      if (row && (row.status === "VALIDATED" || row.status === "DECLARED") && action === "prepare") throw errors.conflict("VAT_VALIDATED", "Cette déclaration est validée : rouvrez-la pour la préparer à nouveau.");
      if (row?.status === "DECLARED") throw errors.conflict("VAT_DECLARED", "Cette déclaration est indiquée comme déposée.");
      if (action === "validate" && row?.status !== "PREPARED") throw errors.conflict("VAT_NOT_PREPARED", "Préparez la déclaration et vérifiez-la avant de la valider.");
      const computation = await computeVat(companyId, bounds.startDate, bounds.endDate);
      const snapshot = snapshotOf(computation, await previousCredit(companyId, bounds.startDate));
      if (action === "validate" && row && (!dec(row.collectedVat).equals(snapshot.collected) || !dec(row.deductibleVat).equals(snapshot.deductible) || !dec(row.deductibleVatAssets).equals(snapshot.deductibleAssets) || !dec(row.creditCarriedOver).equals(snapshot.creditCarriedOver))) {
        throw errors.conflict("VAT_CHANGED", "Les opérations de la période ont changé depuis la préparation : préparez à nouveau la déclaration et vérifiez-la.");
      }
      const data = {
        regime: company.vatRegime,
        formType: bounds.formType,
        dueDate: fromIsoDate(depositDeadline(bounds)),
        collectedVat: snapshot.collected.toFixed(2),
        deductibleVat: snapshot.deductible.toFixed(2),
        deductibleVatAssets: snapshot.deductibleAssets.toFixed(2),
        creditCarriedOver: snapshot.creditCarriedOver.toFixed(2),
        netVatDue: snapshot.net.toFixed(2),
        breakdown: { collectedByRate: computation.collectedByRate, operations: computation.operations.length } as Prisma.InputJsonValue,
        status: action === "prepare" ? ("PREPARED" as const) : ("VALIDATED" as const),
        ...(action === "validate" ? { validatedAt: new Date(), validatedById: userId } : {}),
      };
      row = row ? await tx.vatPeriod.update({ where: { id: row.id }, data }) : await tx.vatPeriod.create({ data: { companyId, startDate: fromIsoDate(bounds.startDate), endDate: fromIsoDate(bounds.endDate), ...data } });
      const amount = `${snapshot.net.isNegative() ? "crédit de" : "TVA nette due :"} ${snapshot.net.abs().toFixed(2).replace(".", ",")} €`;
      await detail(action === "prepare" ? `Déclaration préparée (${amount})` : `Déclaration validée (${amount}) — à déposer sur l'espace professionnel`);
    } else if (action === "declare") {
      if (row?.status !== "VALIDATED") throw errors.conflict("VAT_NOT_VALIDATED", "Seule une déclaration validée peut être indiquée comme déposée.");
      row = await tx.vatPeriod.update({ where: { id: row.id }, data: { status: "DECLARED", declaredAt: new Date() } });
      await detail("Dépôt de la déclaration indiqué par l'utilisateur");
    } else {
      if (!row || row.status === "OPEN") throw errors.conflict("VAT_NOT_PREPARED", "Cette déclaration n'est pas préparée.");
      if (row.status === "DECLARED") throw errors.conflict("VAT_DECLARED", "Une déclaration déposée ne se rouvre pas : une erreur se corrige sur une déclaration ultérieure.");
      const next = await tx.vatPeriod.findFirst({ where: { companyId, startDate: fromIsoDate(addDays(bounds.endDate, 1)), status: { in: ["VALIDATED", "DECLARED"] } } });
      if (next) throw errors.conflict("VAT_NEXT_VALIDATED", "La déclaration suivante est déjà validée : elle reprend le crédit de celle-ci.");
      row = await tx.vatPeriod.update({ where: { id: row.id }, data: { status: "PREPARED", validatedAt: null, validatedById: null } });
      await detail("Déclaration rouverte");
    }
    periodId = row!.id;
  });
  await syncAccountingFor(company, [{ type: "VAT_RETURN", id: periodId }]);
  return getVatPeriod(access, startDate);
}

export async function vatPeriodCsv(access: CompanyAccess, startDate: IsoDate): Promise<{ fileName: string; content: string }> {
  const bounds = boundsFor(access.company, startDate);
  const computation = await computeVat(access.company.id, bounds.startDate, bounds.endDate);
  const natures = { COLLECTED: "TVA collectée", DEDUCTIBLE: "TVA déductible — biens et services", DEDUCTIBLE_ASSETS: "TVA déductible — immobilisations" };
  return {
    fileName: `tva-${bounds.startDate}-${bounds.endDate}.csv`,
    content: toCsv(
      ["Date", "Nature", "Opération", "Référence", "Tiers ou libellé", "Taux", "Base HT", "TVA"],
      computation.operations.map((o) => [o.date, natures[o.nature], VAT_OPERATION_LABELS[o.kind], o.reference, o.label, o.rate ? `${o.rate.replace(".", ",")} %` : "", csvAmount(dec(o.base)), csvAmount(dec(o.vat))]),
    ),
  };
}

export type VatSimulation = {
  current: { label: string; startDate: string; endDate: string; collected: string; deductible: string; netVatDue: string; dueDate: string } | null;
  /** Régime simplifié : acomptes semestriels calculés sur la TVA due de l'exercice précédent. */
  installments: { base: string; july: string; december: string; source: string } | null;
  deadline: VatDeadline | null;
};

/** Simulation : TVA de la période en cours à ce jour, et acomptes du régime simplifié. */
export async function vatSimulation(access: CompanyAccess): Promise<VatSimulation> {
  const company = access.company;
  const today = todayInParis();
  const deadline = nextVatDeadline(company.vatRegime, company.fiscalYearStartMonth, today);
  if (company.vatRegime === "FRANCHISE") return { current: null, installments: null, deadline: null };
  const bounds = periodsBetween(company, today, today)[0];
  const computation = await computeVat(company.id, bounds.startDate, today);
  const credit = await previousCredit(company.id, bounds.startDate);
  const net = dec(computation.balance).minus(credit);
  let installments: VatSimulation["installments"] = null;
  if (company.vatRegime === "REEL_SIMPLIFIE") {
    const previous = await access.db.vatPeriod.findFirst({ where: { endDate: fromIsoDate(addDays(bounds.startDate, -1)), status: { in: ["VALIDATED", "DECLARED"] } } });
    if (previous) {
      // Base des acomptes : TVA due de l'exercice précédent avant déduction de la TVA sur immobilisations.
      const base = dec(previous.netVatDue).plus(dec(previous.deductibleVatAssets));
      installments = base.lessThan(1000)
        ? { base: toMoneyString(base), july: "0.00", december: "0.00", source: "La TVA due de l'exercice précédent est inférieure à 1 000 € : pas d'acompte." }
        : { base: toMoneyString(base), july: toMoneyString(base.times("0.55").toDecimalPlaces(0)), december: toMoneyString(base.times("0.40").toDecimalPlaces(0)), source: "Calculés sur la déclaration annuelle validée de l'exercice précédent." };
    }
  }
  return {
    current: { label: bounds.label, startDate: bounds.startDate, endDate: bounds.endDate, collected: computation.collected, deductible: computation.deductible, netVatDue: toMoneyString(net), dueDate: depositDeadline(bounds) },
    installments,
    deadline,
  };
}
