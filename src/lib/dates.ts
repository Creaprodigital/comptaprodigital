/**
 * Dates calendaires.
 *
 * Les colonnes DATE de MySQL sont manipulées comme des chaînes ISO « AAAA-MM-JJ »
 * ou des `Date` à minuit UTC, pour ne dépendre d'aucun fuseau lors des calculs.
 * « Aujourd'hui » est toujours évalué en heure de Paris.
 */

export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function fromIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

const parisFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date du jour à Paris, au format « AAAA-MM-JJ ». */
export function todayInParis(now: Date = new Date()): IsoDate {
  return parisFormatter.format(now);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Ajoute des mois en conservant le jour quand c'est possible (31 janv. + 1 mois = 28/29 févr.). */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = fromIsoDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

export function startOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: IsoDate): IsoDate {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

export function startOfQuarter(value: IsoDate): IsoDate {
  const month = Number(value.slice(5, 7));
  const quarterStartMonth = month - ((month - 1) % 3);
  return `${value.slice(0, 4)}-${String(quarterStartMonth).padStart(2, "0")}-01`;
}

export function endOfQuarter(value: IsoDate): IsoDate {
  return addDays(addMonths(startOfQuarter(value), 3), -1);
}

export function startOfYear(value: IsoDate): IsoDate {
  return `${value.slice(0, 4)}-01-01`;
}

export function endOfYear(value: IsoDate): IsoDate {
  return `${value.slice(0, 4)}-12-31`;
}

export function diffInDays(from: IsoDate, to: IsoDate): number {
  return Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / 86_400_000);
}

/** Clé de mois « AAAA-MM ». */
export function monthKey(value: IsoDate): string {
  return value.slice(0, 7);
}

const MONTH_LABELS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTH_NAMES = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** « 2026-03 » → « mars 26 » */
export function shortMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year.slice(2)}`;
}

/** Nom complet du mois (1 = janvier). */
export function monthName(month: number): string {
  return MONTH_NAMES[(((month - 1) % 12) + 12) % 12];
}

/** « 2026-03-05 » → « 05/03/2026 » */
export function formatIsoForHumans(value: IsoDate): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
