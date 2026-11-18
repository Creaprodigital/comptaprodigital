import { describe, expect, it } from "vitest";
import { days360, decliningCoefficient, depreciationPlan } from "@/lib/depreciation";

const plan = (input: Parameters<typeof depreciationPlan>[0], startMonth = 1) => depreciationPlan(input, startMonth).map((r) => [r.start.slice(0, 4), r.amount.toFixed(2), r.netBookValue.toFixed(2)]);

describe("plans d'amortissement", () => {
  it("compte les jours selon la convention 30/360", () => {
    expect(days360("2026-01-01", "2026-12-31")).toBe(360);
    expect(days360("2026-04-01", "2026-12-31")).toBe(270);
    expect(days360("2026-07-15", "2026-12-31")).toBe(166);
    expect(days360("2026-03-01", "2026-03-31")).toBe(30);
  });

  it("calcule un plan linéaire au prorata temporis, soldé la dernière année", () => {
    expect(plan({ cost: "3000", residualValue: "0", method: "LINEAR", durationMonths: 36, acquisitionDate: "2026-04-01", serviceDate: "2026-04-01" })).toEqual([
      ["2026", "750.00", "2250.00"],
      ["2027", "1000.00", "1250.00"],
      ["2028", "1000.00", "250.00"],
      ["2029", "250.00", "0.00"],
    ]);
  });

  it("tient compte d'une valeur résiduelle et d'un exercice décalé", () => {
    const rows = depreciationPlan({ cost: "12000", residualValue: "2000", method: "LINEAR", durationMonths: 60, acquisitionDate: "2026-10-01", serviceDate: "2026-10-01" }, 7);
    expect(rows[0]).toMatchObject({ start: "2026-07-01", end: "2027-06-30" });
    expect(rows[0].amount.toFixed(2)).toBe("1500.00"); // 9 mois sur 60 de 10 000
    expect(rows.at(-1)!.netBookValue.toFixed(2)).toBe("2000.00");
    expect(rows.reduce((acc, r) => acc + Number(r.amount.toFixed(2)), 0)).toBe(10000);
  });

  it("arrête le plan à la date de sortie", () => {
    const rows = depreciationPlan({ cost: "3600", residualValue: "0", method: "LINEAR", durationMonths: 36, acquisitionDate: "2026-01-01", serviceDate: "2026-01-01", disposedAt: "2027-06-30" }, 1);
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(["1200.00", "600.00"]);
  });

  it("calcule un plan dégressif avec coefficient fiscal et bascule en linéaire", () => {
    expect(decliningCoefficient(36).toString()).toBe("1.25");
    expect(decliningCoefficient(60).toString()).toBe("1.75");
    expect(decliningCoefficient(84).toString()).toBe("2.25");
    // 10 000 € sur 5 ans : taux 35 %, acquis le 15 avril (9 mois la première année).
    const rows = plan({ cost: "10000", residualValue: "0", method: "DECLINING", durationMonths: 60, acquisitionDate: "2026-04-15", serviceDate: "2026-05-01" });
    expect(rows).toEqual([
      ["2026", "2625.00", "7375.00"],
      ["2027", "2581.25", "4793.75"],
      ["2028", "1677.81", "3115.94"],
      ["2029", "1384.86", "1731.08"],
      ["2030", "1384.86", "346.22"],
      ["2031", "346.22", "0.00"],
    ]);
  });
});
