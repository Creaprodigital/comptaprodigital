import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffInDays, endOfMonth, endOfQuarter, isIsoDate, startOfQuarter, todayInParis } from "@/lib/dates";
import { fiscalYearBounds } from "@/server/modules/companies/fiscal-year";
import { resolveDateRange } from "@/server/modules/dashboard/periods";

describe("dates calendaires", () => {
  it("valide les dates ISO", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("28/02/2026")).toBe(false);
  });

  it("gère les fins de mois et les années bissextiles", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffInDays("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("calcule les trimestres civils", () => {
    expect(startOfQuarter("2026-11-13")).toBe("2026-10-01");
    expect(endOfQuarter("2026-11-13")).toBe("2026-12-31");
    expect(startOfQuarter("2026-03-31")).toBe("2026-01-01");
  });

  it("évalue « aujourd'hui » en heure de Paris", () => {
    // 23 h 30 UTC le 31 décembre : déjà le 1er janvier à Paris.
    expect(todayInParis(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayInParis(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
    expect(todayInParis(new Date("2026-06-30T22:01:00Z"))).toBe("2026-07-01");
  });
});

describe("exercice comptable", () => {
  it("retourne l'année civile pour une ouverture en janvier", () => {
    expect(fiscalYearBounds(1, "2026-11-13")).toEqual({ startDate: "2026-01-01", endDate: "2026-12-31", label: "Exercice 2026" });
  });

  it("gère un exercice décalé", () => {
    expect(fiscalYearBounds(7, "2026-11-13")).toEqual({ startDate: "2026-07-01", endDate: "2027-06-30", label: "Exercice 2026-2027" });
    expect(fiscalYearBounds(7, "2026-03-01")).toEqual({ startDate: "2025-07-01", endDate: "2026-06-30", label: "Exercice 2025-2026" });
    expect(fiscalYearBounds(7, "2026-07-01").startDate).toBe("2026-07-01");
  });
});

describe("filtres de période du tableau de bord", () => {
  const today = "2026-11-13";

  it("résout les périodes prédéfinies", () => {
    expect(resolveDateRange({ preset: "7d" }, today)).toEqual({ preset: "7d", from: "2026-11-07", to: today });
    expect(resolveDateRange({ preset: "30d" }, today)).toEqual({ preset: "30d", from: "2026-10-15", to: today });
    expect(resolveDateRange({ preset: "quarter" }, today)).toEqual({ preset: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(resolveDateRange({ preset: "year" }, today)).toEqual({ preset: "year", from: "2026-01-01", to: "2026-12-31" });
  });

  it("accepte une période personnalisée valide", () => {
    expect(resolveDateRange({ preset: "custom", from: "2026-01-15", to: "2026-03-31" }, today)).toEqual({
      preset: "custom",
      from: "2026-01-15",
      to: "2026-03-31",
    });
  });

  it("retombe sur 30 jours pour toute entrée invalide", () => {
    const fallback = { preset: "30d", from: "2026-10-15", to: today };
    expect(resolveDateRange({}, today)).toEqual(fallback);
    expect(resolveDateRange({ preset: "n'importe quoi" }, today)).toEqual(fallback);
    expect(resolveDateRange({ preset: "custom", from: "2026-03-31", to: "2026-01-15" }, today)).toEqual(fallback);
    expect(resolveDateRange({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, today)).toEqual(fallback);
    expect(resolveDateRange({ preset: "custom", from: "2010-01-01", to: "2026-03-01" }, today)).toEqual(fallback);
    expect(resolveDateRange({ preset: "custom", from: "'; DROP TABLE users; --", to: "2026-03-01" }, today)).toEqual(fallback);
  });
});
