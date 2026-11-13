import {
  addDays,
  diffInDays,
  endOfQuarter,
  endOfYear,
  isIsoDate,
  startOfQuarter,
  startOfYear,
  type IsoDate,
} from "@/lib/dates";

export const PERIOD_PRESETS = ["7d", "30d", "quarter", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "7 jours",
  "30d": "30 jours",
  quarter: "Trimestre",
  year: "Année",
  custom: "Personnalisée",
};

export type DateRange = { preset: PeriodPreset; from: IsoDate; to: IsoDate };

const MAX_CUSTOM_RANGE_DAYS = 366 * 5;

/**
 * Convertit un filtre de période en bornes de dates incluses.
 * Une période personnalisée invalide retombe sur les 30 derniers jours.
 */
export function resolveDateRange(
  input: { preset?: string | null; from?: string | null; to?: string | null },
  today: IsoDate,
): DateRange {
  const preset = PERIOD_PRESETS.includes(input.preset as PeriodPreset) ? (input.preset as PeriodPreset) : "30d";
  switch (preset) {
    case "7d":
      return { preset, from: addDays(today, -6), to: today };
    case "quarter":
      return { preset, from: startOfQuarter(today), to: endOfQuarter(today) };
    case "year":
      return { preset, from: startOfYear(today), to: endOfYear(today) };
    case "custom": {
      const { from, to } = input;
      if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to && diffInDays(from, to) <= MAX_CUSTOM_RANGE_DAYS) {
        return { preset, from, to };
      }
      return { preset: "30d", from: addDays(today, -29), to: today };
    }
    default:
      return { preset: "30d", from: addDays(today, -29), to: today };
  }
}
