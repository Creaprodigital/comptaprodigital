import { describe, expect, it } from "vitest";
import { dec, roundMoney, sum, toMoneyString, vatFromExclTax, vatShareOfPayment } from "@/lib/money";

describe("arithmétique monétaire exacte", () => {
  it("n'accumule pas d'erreur de virgule flottante", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // rappel du problème
    expect(sum(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(sum(Array.from({ length: 1000 }, () => "0.01")).toFixed(2)).toBe("10.00");
  });

  it("arrondit au centime, demi supérieur en valeur absolue", () => {
    expect(roundMoney("1.005").toFixed(2)).toBe("1.01");
    expect(roundMoney("2.675").toFixed(2)).toBe("2.68");
    expect(roundMoney("-1.005").toFixed(2)).toBe("-1.01");
    expect(roundMoney("1.004").toFixed(2)).toBe("1.00");
  });

  it("sérialise toujours avec deux décimales", () => {
    expect(toMoneyString(null)).toBe("0.00");
    expect(toMoneyString("12")).toBe("12.00");
    expect(toMoneyString(dec("1234.5"))).toBe("1234.50");
  });

  it("calcule la TVA d'un montant hors taxes", () => {
    expect(vatFromExclTax("100.00", "20").toFixed(2)).toBe("20.00");
    expect(vatFromExclTax("19.99", "5.5").toFixed(2)).toBe("1.10");
    expect(vatFromExclTax("33.33", "20").toFixed(2)).toBe("6.67");
    expect(vatFromExclTax("250", "0").toFixed(2)).toBe("0.00");
  });

  it("répartit la TVA d'un règlement partiel au prorata de la facture", () => {
    // Facture 1 000 HT + 200 TVA = 1 200 TTC, réglée pour moitié.
    expect(vatShareOfPayment("600.00", "200.00", "1200.00").toFixed(2)).toBe("100.00");
    // Trois tiers d'une facture de 100 TTC dont 16,67 de TVA.
    expect(vatShareOfPayment("33.33", "16.67", "100.00").toFixed(2)).toBe("5.56");
    expect(vatShareOfPayment("50.00", "0.00", "0.00").toFixed(2)).toBe("0.00");
  });
});
