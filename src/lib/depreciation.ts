import Decimal from "decimal.js";
import { addDays, addMonths, type IsoDate } from "@/lib/dates";

/**
 * Plans d'amortissement, par exercice.
 *
 *  - **Linéaire** : prorata temporis en jours à compter de la mise en service, sur
 *    la base de mois de 30 jours et d'années de 360 jours. La dernière annuité
 *    solde la base amortissable.
 *  - **Dégressif** : taux linéaire × coefficient fiscal (1,25 pour 3 ou 4 ans ;
 *    1,75 pour 5 ou 6 ans ; 2,25 au-delà), appliqué à la valeur nette ; prorata
 *    en mois à compter du premier jour du mois d'acquisition ; bascule en linéaire
 *    dès que l'annuité linéaire sur la durée restante devient supérieure.
 *
 * Ces règles sont celles généralement admises ; leur application à chaque bien
 * (durée d'usage, éligibilité au dégressif) relève d'un professionnel.
 */

export type AssetPlanInput = {
  cost: Decimal.Value;
  residualValue: Decimal.Value;
  method: "LINEAR" | "DECLINING";
  durationMonths: number;
  acquisitionDate: IsoDate;
  serviceDate: IsoDate;
  disposedAt?: IsoDate | null;
};

export type PlanPeriod = { start: IsoDate; end: IsoDate };
export type PlanRow = PlanPeriod & { amount: Decimal; cumulative: Decimal; netBookValue: Decimal };

const ZERO = new Decimal(0);
const round = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Nombre de jours (convention 30/360) du `start` au `end` inclus. */
export function days360(start: IsoDate, end: IsoDate): number {
  if (end < start) return 0;
  const next = addDays(end, 1);
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = next.split("-").map(Number);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (Math.min(d2, 30) - Math.min(d1, 30));
}

/** Nombre de mois entamés du mois de `start` au mois de `end` inclus. */
function monthsBetween(start: IsoDate, end: IsoDate): number {
  if (end < start) return 0;
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export function decliningCoefficient(durationMonths: number): Decimal {
  const years = durationMonths / 12;
  if (years < 3) return new Decimal(1);
  if (years <= 4) return new Decimal("1.25");
  if (years <= 6) return new Decimal("1.75");
  return new Decimal("2.25");
}

/** Exercices successifs (de même calendrier que `fiscalYearStartMonth`) à partir de celui qui contient `date`. */
export function fiscalPeriodsFrom(date: IsoDate, fiscalYearStartMonth: number, count: number): PlanPeriod[] {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  let start = `${month >= fiscalYearStartMonth ? year : year - 1}-${String(fiscalYearStartMonth).padStart(2, "0")}-01`;
  const periods: PlanPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const next = addMonths(start, 12);
    periods.push({ start, end: addDays(next, -1) });
    start = next;
  }
  return periods;
}

/**
 * Plan d'amortissement sur les exercices fournis (ou générés à partir du mois
 * d'ouverture). S'arrête une fois le bien amorti ou sorti de l'actif.
 */
export function depreciationPlan(asset: AssetPlanInput, periodsOrStartMonth: PlanPeriod[] | number): PlanRow[] {
  const base = new Decimal(asset.cost.toString()).minus(new Decimal(asset.residualValue.toString()));
  const maxPeriods = Math.ceil(asset.durationMonths / 12) + 2;
  const periods = typeof periodsOrStartMonth === "number" ? fiscalPeriodsFrom(asset.method === "DECLINING" ? asset.acquisitionDate : asset.serviceDate, periodsOrStartMonth, maxPeriods) : periodsOrStartMonth;
  const rows: PlanRow[] = [];
  let cumulative = ZERO;
  const disposal = asset.disposedAt ?? null;

  if (asset.method === "LINEAR") {
    const totalDays = asset.durationMonths * 30;
    const end = addDays(addMonths(asset.serviceDate, asset.durationMonths), -1);
    for (const period of periods) {
      if (cumulative.greaterThanOrEqualTo(base)) break;
      if (period.end < asset.serviceDate) continue;
      if (disposal && period.start > disposal) break;
      const from = period.start > asset.serviceDate ? period.start : asset.serviceDate;
      const to = [period.end, end, disposal ?? period.end].sort()[0];
      const last = to >= end;
      let amount = last ? base.minus(cumulative) : round(base.times(days360(from, to)).dividedBy(totalDays));
      amount = Decimal.min(amount, base.minus(cumulative));
      cumulative = cumulative.plus(amount);
      rows.push({ ...period, amount, cumulative, netBookValue: new Decimal(asset.cost.toString()).minus(cumulative) });
      if (last) break;
    }
    return rows;
  }

  // Dégressif
  const rate = new Decimal(12).dividedBy(asset.durationMonths).times(decliningCoefficient(asset.durationMonths));
  const startMonth = `${asset.acquisitionDate.slice(0, 7)}-01`;
  const end = addDays(addMonths(startMonth, asset.durationMonths), -1);
  for (const period of periods) {
    if (cumulative.greaterThanOrEqualTo(base)) break;
    if (period.end < startMonth) continue;
    if (disposal && period.start > disposal) break;
    const from = period.start > startMonth ? period.start : startMonth;
    const to = [period.end, end, disposal ?? period.end].sort()[0];
    const months = monthsBetween(from, to);
    const remainingBase = base.minus(cumulative);
    const remainingMonths = monthsBetween(from, end);
    const declining = remainingBase.times(rate).times(months).dividedBy(12);
    const linear = remainingBase.times(months).dividedBy(remainingMonths);
    const last = to >= end;
    let amount = last ? remainingBase : round(Decimal.max(declining, linear));
    amount = Decimal.min(amount, remainingBase);
    cumulative = cumulative.plus(amount);
    rows.push({ ...period, amount, cumulative, netBookValue: new Decimal(asset.cost.toString()).minus(cumulative) });
    if (last) break;
  }
  return rows;
}

/** Dotation prévue pour un exercice donné. */
export function plannedDepreciation(asset: AssetPlanInput, period: PlanPeriod, fiscalYearStartMonth: number): Decimal {
  return depreciationPlan(asset, fiscalYearStartMonth).find((row) => row.start === period.start)?.amount ?? ZERO;
}
