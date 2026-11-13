import { addDays, addMonths, type IsoDate } from "@/lib/dates";

/** Bornes de l'exercice comptable contenant `today`, pour un mois d'ouverture donné (1 = janvier). */
export function fiscalYearBounds(startMonth: number, today: IsoDate): { startDate: IsoDate; endDate: IsoDate; label: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = addDays(addMonths(startDate, 12), -1);
  const endYear = Number(endDate.slice(0, 4));
  const label = startYear === endYear ? `Exercice ${startYear}` : `Exercice ${startYear}-${endYear}`;
  return { startDate, endDate, label };
}
