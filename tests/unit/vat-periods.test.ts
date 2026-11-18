import { describe, expect, it } from "vitest";
import { depositDeadline, periodsBetween } from "@/server/modules/vat/service";

describe("périodes de déclaration de TVA", () => {
  it("découpe l'année selon le régime", () => {
    expect(periodsBetween({ vatRegime: "REEL_NORMAL_MENSUEL", fiscalYearStartMonth: 1 }, "2026-01-01", "2026-03-15").map((p) => [p.startDate, p.endDate, p.label])).toEqual([
      ["2026-01-01", "2026-01-31", "Janvier 2026"],
      ["2026-02-01", "2026-02-28", "Février 2026"],
      ["2026-03-01", "2026-03-31", "Mars 2026"],
    ]);
    expect(periodsBetween({ vatRegime: "REEL_NORMAL_TRIMESTRIEL", fiscalYearStartMonth: 1 }, "2026-02-10", "2026-07-01").map((p) => [p.startDate, p.endDate, p.label])).toEqual([
      ["2026-01-01", "2026-03-31", "1er trimestre 2026"],
      ["2026-04-01", "2026-06-30", "2e trimestre 2026"],
      ["2026-07-01", "2026-09-30", "3e trimestre 2026"],
    ]);
    expect(periodsBetween({ vatRegime: "REEL_SIMPLIFIE", fiscalYearStartMonth: 1 }, "2026-01-01", "2026-12-31")).toEqual([{ startDate: "2026-01-01", endDate: "2026-12-31", formType: "CA12", label: "Exercice 2026" }]);
    expect(periodsBetween({ vatRegime: "REEL_SIMPLIFIE", fiscalYearStartMonth: 7 }, "2026-01-01", "2026-12-31").map((p) => [p.startDate, p.endDate, p.formType])).toEqual([
      ["2025-07-01", "2026-06-30", "CA12E"],
      ["2026-07-01", "2027-06-30", "CA12E"],
    ]);
    expect(periodsBetween({ vatRegime: "FRANCHISE", fiscalYearStartMonth: 1 }, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("indique la date limite de la fenêtre de dépôt", () => {
    expect(depositDeadline({ startDate: "2026-10-01", endDate: "2026-10-31", formType: "CA3", label: "" })).toBe("2026-11-24");
    expect(depositDeadline({ startDate: "2026-10-01", endDate: "2026-12-31", formType: "CA3", label: "" })).toBe("2027-01-24");
    expect(depositDeadline({ startDate: "2026-01-01", endDate: "2026-12-31", formType: "CA12", label: "" })).toBe("2027-05-04");
    expect(depositDeadline({ startDate: "2025-07-01", endDate: "2026-06-30", formType: "CA12E", label: "" })).toBe("2026-09-30");
  });
});
