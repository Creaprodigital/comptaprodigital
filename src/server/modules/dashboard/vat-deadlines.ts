import { addDays, addMonths, endOfMonth, fromIsoDate, monthName, startOfMonth, startOfQuarter, type IsoDate } from "@/lib/dates";
import type { VatRegimeKey } from "@/config/legal";

/**
 * Prochaine échéance de TVA, à titre de rappel.
 *
 * ⚠️ Les dates limites exactes dépendent de la situation de l'entreprise
 * (département, forme juridique, numéro SIREN) : elles sont affichées sur
 * l'espace professionnel impots.gouv.fr. La plateforme indique donc la fenêtre
 * légale (du 15 au 24 du mois) et ne télétransmet jamais de déclaration.
 */

export type VatDeadline = {
  title: string;
  description: string;
  /** Début et fin de la fenêtre de dépôt. */
  windowStart: IsoDate;
  windowEnd: IsoDate;
};

export type VatPeriodBounds = { from: IsoDate; to: IsoDate };

function depositWindow(monthStart: IsoDate): { windowStart: IsoDate; windowEnd: IsoDate } {
  return { windowStart: `${monthStart.slice(0, 7)}-15`, windowEnd: `${monthStart.slice(0, 7)}-24` };
}

function monthLabel(date: IsoDate): string {
  return `${monthName(Number(date.slice(5, 7)))} ${date.slice(0, 4)}`;
}

/** Deuxième jour ouvré (lundi-vendredi) suivant le 1er mai : date limite de la CA12 pour un exercice civil. */
export function secondWorkingDayAfterMayFirst(year: number): IsoDate {
  let date = `${year}-05-01`;
  let workingDays = 0;
  while (workingDays < 2) {
    date = addDays(date, 1);
    const weekday = fromIsoDate(date).getUTCDay();
    if (weekday !== 0 && weekday !== 6) workingDays++;
  }
  return date;
}

const SUFFIX = "Date limite exacte indiquée dans votre espace professionnel impots.gouv.fr.";

export function nextVatDeadline(vatRegime: VatRegimeKey, fiscalYearStartMonth: number, today: IsoDate): VatDeadline | null {
  if (vatRegime === "FRANCHISE") return null;

  if (vatRegime === "REEL_NORMAL_MENSUEL") {
    const thisMonth = startOfMonth(today);
    const current = depositWindow(thisMonth);
    const declarationMonth = today <= current.windowEnd ? thisMonth : addMonths(thisMonth, 1);
    const period = addMonths(declarationMonth, -1);
    return {
      title: `Déclaration de TVA CA3 — ${monthLabel(period)}`,
      description: `À déposer entre le 15 et le 24 ${monthLabel(declarationMonth)}. ${SUFFIX}`,
      ...depositWindow(declarationMonth),
    };
  }

  if (vatRegime === "REEL_NORMAL_TRIMESTRIEL") {
    const quarterStart = startOfQuarter(today);
    const current = depositWindow(quarterStart);
    // La déclaration du trimestre écoulé se dépose le premier mois du trimestre suivant.
    const declarationMonth = today <= current.windowEnd ? quarterStart : addMonths(quarterStart, 3);
    const periodStart = addMonths(declarationMonth, -3);
    const periodEnd = endOfMonth(addMonths(declarationMonth, -1));
    return {
      title: `Déclaration de TVA CA3 trimestrielle — ${monthLabel(periodStart)} à ${monthLabel(periodEnd)}`,
      description: `À déposer entre le 15 et le 24 ${monthLabel(declarationMonth)}. ${SUFFIX}`,
      ...depositWindow(declarationMonth),
    };
  }

  // Réel simplifié : déclaration annuelle CA12 et deux acomptes (juillet 55 %, décembre 40 %).
  const year = Number(today.slice(0, 4));
  const candidates: VatDeadline[] = [];
  for (const y of [year, year + 1]) {
    candidates.push({
      title: "Acompte de TVA de juillet (55 %)",
      description: `Acompte semestriel du régime simplifié, à régler entre le 15 et le 24 juillet ${y}, si la TVA due l'an dernier atteint 1 000 €. ${SUFFIX}`,
      ...depositWindow(`${y}-07-01`),
    });
    candidates.push({
      title: "Acompte de TVA de décembre (40 %)",
      description: `Acompte semestriel du régime simplifié, à régler entre le 15 et le 24 décembre ${y}, si la TVA due l'an dernier atteint 1 000 €. ${SUFFIX}`,
      ...depositWindow(`${y}-12-01`),
    });
    if (fiscalYearStartMonth === 1) {
      const limit = secondWorkingDayAfterMayFirst(y);
      candidates.push({
        title: `Déclaration annuelle de TVA CA12 — exercice ${y - 1}`,
        description: `À déposer au plus tard le deuxième jour ouvré suivant le 1er mai ${y}. ${SUFFIX}`,
        windowStart: `${y}-04-01`,
        windowEnd: limit,
      });
    } else {
      // Exercice décalé : dépôt dans les trois mois suivant la clôture.
      const closing = addDays(`${y}-${String(fiscalYearStartMonth).padStart(2, "0")}-01`, -1);
      const limit = addMonths(closing, 3);
      candidates.push({
        title: "Déclaration annuelle de TVA CA12E",
        description: `À déposer dans les trois mois suivant la clôture de l'exercice (${monthLabel(closing)}). ${SUFFIX}`,
        windowStart: addDays(closing, 1),
        windowEnd: limit,
      });
    }
  }
  return candidates.filter((c) => c.windowEnd >= today).sort((a, b) => a.windowEnd.localeCompare(b.windowEnd))[0] ?? null;
}

/** Période de déclaration en cours, utilisée pour provisionner la TVA dans la trésorerie disponible. */
export function currentVatPeriod(vatRegime: VatRegimeKey, fiscalYear: VatPeriodBounds, today: IsoDate): VatPeriodBounds | null {
  switch (vatRegime) {
    case "FRANCHISE":
      return null;
    case "REEL_NORMAL_MENSUEL":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "REEL_NORMAL_TRIMESTRIEL":
      return { from: startOfQuarter(today), to: endOfMonth(addMonths(startOfQuarter(today), 2)) };
    case "REEL_SIMPLIFIE":
      return fiscalYear;
  }
}
