import { describe, expect, it } from "vitest";
import { InvoicingError, computeDocumentTotals, computeLine, formatDocumentNumber, remainingAmount } from "@/lib/invoicing";
import { billingSettingsSchema, customerSchema, decimalString, invoiceSchema, isValidIban, paymentSchema, productSchema } from "@/lib/schemas/invoicing";

const money = (value: { toFixed(n: number): string }) => value.toFixed(2);

describe("calcul d'une ligne", () => {
  it("multiplie quantité et prix, applique la remise, arrondit au centime", () => {
    const line = computeLine({ quantity: "3", unitPriceExclTax: "19.99", discountRate: "10", vatRate: "20" });
    // 3 × 19,99 = 59,97 ; −10 % = 53,973 → 53,97 ; TVA 20 % = 10,794 → 10,79
    expect([money(line.totalExclTax), money(line.totalVat), money(line.totalInclTax)]).toEqual(["53.97", "10.79", "64.76"]);
  });

  it("gère les quantités et prix à quatre décimales", () => {
    const line = computeLine({ quantity: "1.5", unitPriceExclTax: "0.3333", vatRate: "5.5" });
    // 1,5 × 0,3333 = 0,49995 → 0,50 ; TVA 5,5 % = 0,0275 → 0,03
    expect([money(line.totalExclTax), money(line.totalVat)]).toEqual(["0.50", "0.03"]);
  });

  it("accepte une ligne négative (déduction d'acompte)", () => {
    const line = computeLine({ quantity: "1", unitPriceExclTax: "-300", vatRate: "20" });
    expect([money(line.totalExclTax), money(line.totalVat), money(line.totalInclTax)]).toEqual(["-300.00", "-60.00", "-360.00"]);
  });
});

describe("totaux d'un document", () => {
  const lines = [
    { quantity: "1", unitPriceExclTax: "1000", vatRate: "20" },
    { quantity: "2", unitPriceExclTax: "250", vatRate: "10" },
    { quantity: "10", unitPriceExclTax: "5.5", vatRate: "5.5" },
  ];

  it("ventile la TVA par taux", () => {
    const totals = computeDocumentTotals(lines);
    expect(money(totals.subtotalExclTax)).toBe("1555.00");
    expect(totals.vatBreakdown.map((row) => [row.rate.toFixed(2), money(row.base), money(row.vat)])).toEqual([
      ["20.00", "1000.00", "200.00"],
      ["10.00", "500.00", "50.00"],
      ["5.50", "55.00", "3.03"], // 3,025 → 3,03
    ]);
    expect([money(totals.totalExclTax), money(totals.totalVat), money(totals.totalInclTax)]).toEqual(["1555.00", "253.03", "1808.03"]);
  });

  it("répartit une remise en pourcentage au prorata des bases", () => {
    const totals = computeDocumentTotals(lines, { type: "PERCENT", value: "10" });
    expect(money(totals.discountAmount)).toBe("155.50");
    expect(totals.vatBreakdown.map((row) => [money(row.base), money(row.vat)])).toEqual([
      ["900.00", "180.00"],
      ["450.00", "45.00"],
      ["49.50", "2.72"], // 2,7225 → 2,72
    ]);
    expect([money(totals.totalExclTax), money(totals.totalVat), money(totals.totalInclTax)]).toEqual(["1399.50", "227.72", "1627.22"]);
  });

  it("répartit une remise en montant sans perdre un centime", () => {
    const totals = computeDocumentTotals(
      [
        { quantity: "1", unitPriceExclTax: "33.33", vatRate: "20" },
        { quantity: "1", unitPriceExclTax: "33.33", vatRate: "10" },
        { quantity: "1", unitPriceExclTax: "33.34", vatRate: "5.5" },
      ],
      { type: "AMOUNT", value: "10" },
    );
    const allocated = totals.vatBreakdown.reduce((acc, row) => acc.plus(row.base), totals.discountAmount.minus(totals.discountAmount));
    expect(money(allocated)).toBe("90.00"); // 100,00 − 10,00, exactement
    expect(money(totals.totalExclTax)).toBe("90.00");
    expect(money(totals.totalInclTax)).toBe(money(totals.totalExclTax.plus(totals.totalVat)));
  });

  it("refuse une remise supérieure au total ou hors bornes", () => {
    expect(() => computeDocumentTotals(lines, { type: "AMOUNT", value: "2000" })).toThrow(InvoicingError);
    expect(() => computeDocumentTotals(lines, { type: "PERCENT", value: "101" })).toThrow(InvoicingError);
    expect(() => computeDocumentTotals(lines, { type: "PERCENT", value: "-5" })).toThrow(InvoicingError);
  });

  it("déduit un acompte déjà facturé du total de la facture finale", () => {
    const totals = computeDocumentTotals([
      { quantity: "1", unitPriceExclTax: "1000", vatRate: "20" },
      { quantity: "1", unitPriceExclTax: "-300", vatRate: "20" },
    ]);
    expect([money(totals.totalExclTax), money(totals.totalVat), money(totals.totalInclTax)]).toEqual(["700.00", "140.00", "840.00"]);
  });

  it("applique la remise avant de déduire l'acompte, taux par taux", () => {
    // Devis : 1 000 à 20 % + 500 à 10 %, remise 10 % → bases 900 et 450. Acompte de 30 % déjà facturé : 270 et 135.
    const totals = computeDocumentTotals(
      [
        { quantity: "1", unitPriceExclTax: "1000", vatRate: "20" },
        { quantity: "1", unitPriceExclTax: "500", vatRate: "10" },
        { quantity: "1", unitPriceExclTax: "-270", vatRate: "20" },
        { quantity: "1", unitPriceExclTax: "-135", vatRate: "10" },
      ],
      { type: "PERCENT", value: "10" },
    );
    expect(money(totals.discountAmount)).toBe("150.00"); // 10 % des seules lignes positives
    expect(totals.vatBreakdown.map((row) => [money(row.base), money(row.vat)])).toEqual([
      ["630.00", "126.00"],
      ["315.00", "31.50"],
    ]);
    expect([money(totals.totalExclTax), money(totals.totalInclTax)]).toEqual(["945.00", "1102.50"]);
  });

  it("ne facture aucune TVA en franchise en base", () => {
    const totals = computeDocumentTotals([{ quantity: "4", unitPriceExclTax: "110", vatRate: "0" }]);
    expect([money(totals.totalExclTax), money(totals.totalVat), money(totals.totalInclTax)]).toEqual(["440.00", "0.00", "440.00"]);
  });

  it("reste exact sur un grand nombre de lignes", () => {
    const many = Array.from({ length: 200 }, () => ({ quantity: "1", unitPriceExclTax: "0.10", vatRate: "20" }));
    const totals = computeDocumentTotals(many);
    expect([money(totals.totalExclTax), money(totals.totalVat)]).toEqual(["20.00", "4.00"]);
  });
});

describe("numérotation et reste à encaisser", () => {
  it("formate les numéros de document", () => {
    expect(formatDocumentNumber("F", 2026, 1)).toBe("F-2026-0001");
    expect(formatDocumentNumber("A", 2027, 12345)).toBe("A-2027-12345");
  });

  it("déduit règlements et avoirs du reste à encaisser", () => {
    expect(money(remainingAmount({ totalInclTax: "1200.00", amountPaid: "500.00", creditedAmount: "120.00" }))).toBe("580.00");
  });
});

describe("schémas de la facturation", () => {
  it("normalise les nombres saisis à la française sans passer par un flottant", () => {
    const schema = decimalString({ scale: 2 });
    expect(schema.parse("1 234,56")).toBe("1234.56");
    expect(schema.parse("1 234,5")).toBe("1234.5");
    expect(schema.parse(12.5)).toBe("12.5");
    expect(schema.safeParse("12,345").success).toBe(false);
    expect(schema.safeParse("1e3").success).toBe(false);
    expect(schema.safeParse("abc").success).toBe(false);
    expect(schema.safeParse("=1+1").success).toBe(false);
  });

  it("valide un client et rejette des identifiants incohérents", () => {
    expect(customerSchema.parse({ name: "  Maison Verdier ", siren: "552 100 554", email: "Compta@Verdier.FR" })).toMatchObject({
      name: "Maison Verdier",
      siren: "552100554",
      email: "compta@verdier.fr",
      country: "FR",
      type: "COMPANY",
    });
    expect(customerSchema.safeParse({ name: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "X", siren: "123456789" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "X", siren: "552100554", siret: "73282932000074" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "<b>X</b>" }).success).toBe(false);
  });

  it("valide un produit", () => {
    expect(productSchema.parse({ name: "Conseil", unitPriceExclTax: "110,50", vatRate: "20" })).toMatchObject({ unitPriceExclTax: "110.50", vatRate: "20", type: "SERVICE" });
    expect(productSchema.safeParse({ name: "Conseil", unitPriceExclTax: "-1", vatRate: "20" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "Conseil", unitPriceExclTax: "10", vatRate: "120" }).success).toBe(false);
  });

  it("valide une facture : au moins une ligne, quantité positive, échéance cohérente", () => {
    const line = { description: "Prestation", quantity: "1", unitPriceExclTax: "100", vatRate: "20" };
    const base = { customerId: "c1", issueDate: "2026-11-13", items: [line] };
    expect(invoiceSchema.safeParse(base).success).toBe(true);
    expect(invoiceSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, items: [{ ...line, quantity: "0" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, dueDate: "2026-11-01" }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, issueDate: "13/11/2026" }).success).toBe(false);
  });

  it("valide un règlement", () => {
    expect(paymentSchema.safeParse({ amount: "100", paidAt: "2026-11-13" }).success).toBe(true);
    expect(paymentSchema.safeParse({ amount: "0", paidAt: "2026-11-13" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: "-5", paidAt: "2026-11-13" }).success).toBe(false);
  });

  it("contrôle les IBAN par leur clé", () => {
    expect(isValidIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(isValidIban("FR76 3000 6000 0112 3456 7890 188")).toBe(false);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("pas un iban")).toBe(false);
  });

  it("valide les paramètres de facturation", () => {
    const parsed = billingSettingsSchema.parse({
      invoicePrefix: "fa", quotePrefix: "D", creditNotePrefix: "AV", defaultPaymentTermDays: "30", quoteValidityDays: 30,
      iban: "fr76 3000 6000 0112 3456 7890 189", reminderDelaysDays: [30, 7, 7, 15],
    });
    expect(parsed).toMatchObject({ invoicePrefix: "FA", iban: "FR7630006000011234567890189", reminderDelaysDays: [7, 15, 30], defaultPaymentTermDays: 30 });
    expect(billingSettingsSchema.safeParse({ invoicePrefix: "F-1", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30 }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ invoicePrefix: "F", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 90, quoteValidityDays: 30 }).success).toBe(false);
  });
});
