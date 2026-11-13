import { describe, expect, it } from "vitest";
import { currentVatPeriod, nextVatDeadline, secondWorkingDayAfterMayFirst } from "@/server/modules/dashboard/vat-deadlines";

describe("échéances de TVA", () => {
  it("n'en propose aucune en franchise en base", () => {
    expect(nextVatDeadline("FRANCHISE", 1, "2026-11-13")).toBeNull();
    expect(currentVatPeriod("FRANCHISE", { from: "2026-01-01", to: "2026-12-31" }, "2026-11-13")).toBeNull();
  });

  it("régime réel normal mensuel : déclaration du mois précédent entre le 15 et le 24", () => {
    const before = nextVatDeadline("REEL_NORMAL_MENSUEL", 1, "2026-11-13")!;
    expect(before.title).toContain("octobre 2026");
    expect(before.windowStart).toBe("2026-11-15");
    expect(before.windowEnd).toBe("2026-11-24");

    const after = nextVatDeadline("REEL_NORMAL_MENSUEL", 1, "2026-11-25")!;
    expect(after.title).toContain("novembre 2026");
    expect(after.windowEnd).toBe("2026-12-24");

    const januaryRollover = nextVatDeadline("REEL_NORMAL_MENSUEL", 1, "2026-12-28")!;
    expect(januaryRollover.title).toContain("décembre 2026");
    expect(januaryRollover.windowEnd).toBe("2027-01-24");
  });

  it("régime réel normal trimestriel : déclaration le mois suivant le trimestre", () => {
    const inWindow = nextVatDeadline("REEL_NORMAL_TRIMESTRIEL", 1, "2026-10-10")!;
    expect(inWindow.title).toContain("juillet 2026 à septembre 2026");
    expect(inWindow.windowEnd).toBe("2026-10-24");

    const next = nextVatDeadline("REEL_NORMAL_TRIMESTRIEL", 1, "2026-11-13")!;
    expect(next.title).toContain("octobre 2026 à décembre 2026");
    expect(next.windowEnd).toBe("2027-01-24");
  });

  it("régime simplifié : acomptes de juillet et décembre, déclaration annuelle en mai", () => {
    expect(nextVatDeadline("REEL_SIMPLIFIE", 1, "2026-11-13")!.title).toContain("décembre");
    expect(nextVatDeadline("REEL_SIMPLIFIE", 1, "2026-06-01")!.title).toContain("juillet");
    const annual = nextVatDeadline("REEL_SIMPLIFIE", 1, "2026-03-01")!;
    expect(annual.title).toContain("CA12");
    expect(annual.windowEnd).toBe(secondWorkingDayAfterMayFirst(2026));
  });

  it("calcule le deuxième jour ouvré suivant le 1er mai", () => {
    expect(secondWorkingDayAfterMayFirst(2025)).toBe("2025-05-05"); // 1er mai un jeudi
    expect(secondWorkingDayAfterMayFirst(2026)).toBe("2026-05-05"); // 1er mai un vendredi
    expect(secondWorkingDayAfterMayFirst(2027)).toBe("2027-05-04"); // 1er mai un samedi
  });

  it("détermine la période de déclaration en cours", () => {
    const fiscalYear = { from: "2026-01-01", to: "2026-12-31" };
    expect(currentVatPeriod("REEL_NORMAL_MENSUEL", fiscalYear, "2026-11-13")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(currentVatPeriod("REEL_NORMAL_TRIMESTRIEL", fiscalYear, "2026-11-13")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(currentVatPeriod("REEL_SIMPLIFIE", fiscalYear, "2026-11-13")).toEqual(fiscalYear);
  });
});
