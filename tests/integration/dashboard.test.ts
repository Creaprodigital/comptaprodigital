import { beforeAll, describe, expect, it } from "vitest";
import { getDashboard, type DashboardData } from "@/server/modules/dashboard/service";
import { sha256Hex } from "@/server/security/crypto";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

/**
 * Jeu de données déterministe : chaque indicateur attendu est calculé à la main
 * dans les commentaires, puis comparé au centime près.
 */

const NOW = new Date("2026-11-13T10:00:00Z");
const NOVEMBER = { preset: "custom", from: "2026-11-01", to: "2026-11-30" };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

let companyId: string;
let otherCompanyId: string;
let franchiseCompanyId: string;
let dashboard: DashboardData;

type InvoiceSeed = {
  type?: "INVOICE" | "CREDIT_NOTE";
  status: "DRAFT" | "ISSUED" | "SENT" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  number: string;
  issue: string;
  due?: string;
  ht: string;
  vat: string;
  ttc: string;
  paid?: string;
  exigibility?: "DEBITS" | "ENCAISSEMENTS";
};

async function seedInvoices(company: string, customerId: string, invoices: InvoiceSeed[]) {
  const ids: Record<string, string> = {};
  for (const inv of invoices) {
    const created = await prisma.invoice.create({
      data: {
        companyId: company,
        customerId,
        type: inv.type ?? "INVOICE",
        status: inv.status,
        number: inv.status === "DRAFT" ? null : inv.number,
        issueDate: d(inv.issue),
        dueDate: inv.due ? d(inv.due) : null,
        vatExigibility: inv.exigibility ?? "ENCAISSEMENTS",
        totalExclTax: inv.ht,
        totalVat: inv.vat,
        totalInclTax: inv.ttc,
        amountPaid: inv.paid ?? "0.00",
      },
    });
    ids[inv.number] = created.id;
  }
  return ids;
}

beforeAll(async () => {
  await resetDatabase();
  const owner = await createVerifiedUser({ email: "pilotage@exemple.test", plan: "BUSINESS" });
  companyId = (await createTestCompany(owner.id, "Société Pilotage")).id;
  otherCompanyId = (await createTestCompany(owner.id, "Autre Société")).id;
  franchiseCompanyId = (
    await createTestCompany(owner.id, "Micro Franchise", { legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" })
  ).id;

  const categories = await prisma.transactionCategory.findMany({ where: { companyId: null } });
  const category = (name: string) => categories.find((c) => c.name === name)!.id;
  const customer = await prisma.customer.create({ data: { companyId, name: "Client Pilotage" } });

  const invoices = await seedInvoices(companyId, customer.id, [
    { number: "F-2026-0004", status: "PAID", issue: "2026-11-02", due: "2026-12-02", ht: "1000.00", vat: "200.00", ttc: "1200.00", paid: "1200.00" },
    { number: "F-2026-0003", status: "PARTIALLY_PAID", issue: "2026-10-20", due: "2026-11-05", ht: "2000.00", vat: "400.00", ttc: "2400.00", paid: "600.00" },
    { number: "F-2026-0005", status: "SENT", issue: "2026-11-08", due: "2026-12-08", ht: "500.00", vat: "100.00", ttc: "600.00", exigibility: "DEBITS" },
    { number: "A-2026-0001", type: "CREDIT_NOTE", status: "ISSUED", issue: "2026-11-09", ht: "100.00", vat: "20.00", ttc: "120.00" },
    { number: "BROUILLON", status: "DRAFT", issue: "2026-11-05", ht: "9999.00", vat: "1999.80", ttc: "11998.80" },
    { number: "F-2026-0002", status: "CANCELLED", issue: "2026-11-06", ht: "7777.00", vat: "1555.40", ttc: "9332.40" },
    { number: "F-2026-0001", status: "SENT", issue: "2026-03-15", due: "2026-04-14", ht: "3000.00", vat: "600.00", ttc: "3600.00" },
    { number: "F-2025-0009", status: "PAID", issue: "2025-12-10", due: "2026-01-09", ht: "4000.00", vat: "800.00", ttc: "4800.00", paid: "4800.00" },
  ]);

  const account = await prisma.bankAccount.create({ data: { companyId, name: "Compte courant", openingBalance: "10000.00" } });
  const closedAccount = await prisma.bankAccount.create({ data: { companyId, name: "Ancien compte", openingBalance: "99999.00", isActive: false } });

  const rent = await prisma.purchase.create({
    data: { companyId, label: "Loyer", issueDate: d("2026-11-04"), dueDate: d("2026-11-18"), status: "TO_PAY", categoryId: category("Loyer et charges locatives"), totalExclTax: "300.00", totalVat: "60.00", totalInclTax: "360.00" },
  });
  const telecom = await prisma.purchase.create({
    data: { companyId, label: "Fibre", issueDate: d("2026-11-06"), status: "PAID", categoryId: category("Télécom et internet"), totalExclTax: "100.00", totalVat: "20.00", totalInclTax: "120.00", amountPaid: "120.00", paidAt: d("2026-11-07") },
  });
  await prisma.purchase.createMany({
    data: [
      { companyId, label: "Annulé", issueDate: d("2026-11-07"), status: "CANCELLED", totalExclTax: "5555.00", totalVat: "1111.00", totalInclTax: "6666.00" },
      { companyId, label: "Brouillon", issueDate: d("2026-11-07"), status: "DRAFT", totalExclTax: "4444.00", totalVat: "888.80", totalInclTax: "5332.80" },
    ],
  });
  void rent;

  const tx = (date: string, label: string, amount: string, extra: Record<string, unknown> = {}) =>
    prisma.bankTransaction.create({
      data: { companyId, bankAccountId: account.id, date: d(date), label, amount, fingerprint: sha256Hex(`${date}|${label}|${amount}`), status: "CATEGORIZED", ...extra },
    });

  const t1 = await tx("2026-11-10", "VIR CLIENT F-2026-0004", "1200.00", { categoryId: category("Ventes et prestations"), status: "RECONCILED" });
  await tx("2026-11-07", "PRLV FIBRE", "-120.00", { purchaseId: telecom.id, categoryId: category("Télécom et internet"), status: "RECONCILED" });
  const t3 = await tx("2026-11-05", "FRAIS BANCAIRES", "-55.00", { categoryId: category("Frais bancaires") });
  await tx("2026-11-09", "CB FOURNITURES", "-110.00", { vatAmount: "10.00", status: "TO_REVIEW" });
  await tx("2026-11-10", "PRLV DGFIP TVA", "-2000.00", { categoryId: category("TVA reversée") });
  await tx("2026-11-11", "VIR VERS LIVRET", "-500.00", { categoryId: category("Virement interne") });
  await tx("2026-11-12", "VIR SALAIRE", "-1500.00", { categoryId: category("Salaires") });
  const t8 = await tx("2026-11-03", "VIR CLIENT F-2026-0003", "600.00", { categoryId: category("Ventes et prestations"), status: "RECONCILED" });
  await tx("2026-10-15", "FRAIS BANCAIRES OCT", "-80.00", { categoryId: category("Frais bancaires") });
  await prisma.bankTransaction.create({
    data: { companyId, bankAccountId: closedAccount.id, date: d("2026-11-01"), label: "ANCIEN", amount: "5000.00", fingerprint: sha256Hex("ancien"), status: "CATEGORIZED" },
  });

  await prisma.payment.createMany({
    data: [
      { companyId, invoiceId: invoices["F-2026-0004"], amount: "1200.00", paidAt: d("2026-11-10"), bankTransactionId: t1.id },
      { companyId, invoiceId: invoices["F-2026-0003"], amount: "600.00", paidAt: d("2026-11-03"), bankTransactionId: t8.id },
      { companyId, invoiceId: invoices["F-2025-0009"], amount: "4800.00", paidAt: d("2025-12-20") },
    ],
  });

  // Un justificatif rattaché aux frais bancaires de novembre.
  const document = await prisma.document.create({
    data: { companyId, name: "Relevé de frais", originalFileName: "frais.pdf", mimeType: "application/pdf", sizeBytes: 1024, storageKey: `${companyId}/frais.pdf`, checksumSha256: sha256Hex("frais") },
  });
  await prisma.documentLink.create({ data: { companyId, documentId: document.id, entityType: "BANK_TRANSACTION", entityId: t3.id } });

  // Données d'une autre entreprise du même compte : elles ne doivent jamais apparaître.
  const otherCustomer = await prisma.customer.create({ data: { companyId: otherCompanyId, name: "Client Autre" } });
  await seedInvoices(otherCompanyId, otherCustomer.id, [
    { number: "F-2026-0001", status: "SENT", issue: "2026-11-05", due: "2026-11-06", ht: "50000.00", vat: "10000.00", ttc: "60000.00", exigibility: "DEBITS" },
  ]);
  const otherAccount = await prisma.bankAccount.create({ data: { companyId: otherCompanyId, name: "Compte autre", openingBalance: "777777.00" } });
  await prisma.bankTransaction.create({
    data: { companyId: otherCompanyId, bankAccountId: otherAccount.id, date: d("2026-11-05"), label: "GROSSE DEPENSE", amount: "-33333.00", fingerprint: sha256Hex("autre"), status: "TO_REVIEW" },
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  dashboard = await getDashboard(company, NOVEMBER, NOW);
});

describe("tableau de bord — calculs", () => {
  it("résout la période et l'exercice", () => {
    expect(dashboard.today).toBe("2026-11-13");
    expect(dashboard.range).toEqual({ preset: "custom", from: "2026-11-01", to: "2026-11-30" });
    expect(dashboard.fiscalYear).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(dashboard.isEmpty).toBe(false);
  });

  it("chiffre d'affaires : factures émises HT, avoirs déduits, brouillons et annulées exclus", () => {
    // Novembre : 1 000 + 500 − 100 (avoir) = 1 400
    expect(dashboard.kpis.periodRevenue).toBe("1400.00");
    expect(dashboard.kpis.revenueMonth).toBe("1400.00");
    // Exercice 2026 : 3 000 (mars) + 2 000 (oct.) + 1 400 (nov.) = 6 400 ; décembre 2025 exclu
    expect(dashboard.kpis.revenueFiscalYear).toBe("6400.00");
  });

  it("dépenses : achats HT + décaissements non rattachés, hors virements internes et impôts", () => {
    // Achats 300 + 100 ; banque 55 (frais) + 100 (110 − 10 de TVA) + 1 500 (salaires) = 2 055
    // Exclus : prélèvement rattaché à l'achat (120), TVA reversée (2 000), virement interne (500), achats annulé et brouillon
    expect(dashboard.kpis.periodExpenses).toBe("2055.00");
    expect(dashboard.kpis.periodResult).toBe("-655.00");
  });

  it("TVA estimée : encaissements au prorata, débits à la facturation, avoirs déduits", () => {
    // Encaissements : 1 200 × 200/1 200 = 200 ; 600 × 400/2 400 = 100
    // Débits : 100 ; avoir : −20 → collectée 380
    // Déductible : 60 + 20 (achats) + 10 (opération bancaire) = 90
    expect(dashboard.kpis.periodVat).toEqual({ collected: "380.00", deductible: "90.00", net: "290.00" });
  });

  it("position bancaire : comptes actifs uniquement", () => {
    // 10 000 + 1 200 − 120 − 55 − 110 − 2 000 − 500 − 1 500 + 600 − 80 = 7 435
    expect(dashboard.kpis.bankBalance).toBe("7435.00");
    expect(dashboard.kpis.bankAccountCount).toBe(1);
    // Trésorerie disponible : 7 435 − 290 (TVA de la période en cours) − 360 (fournisseur à payer) = 6 785
    expect(dashboard.kpis.vatProvision).toBe("290.00");
    expect(dashboard.kpis.supplierDebt).toBe("360.00");
    expect(dashboard.kpis.availableCash).toBe("6785.00");
  });

  it("créances : restes à encaisser TTC et factures échues", () => {
    // Impayées : 1 800 + 600 + 3 600 ; en retard (échéance < 13/11) : 1 800 + 3 600
    expect(dashboard.kpis.unpaid).toEqual({ count: 3, amount: "6000.00" });
    expect(dashboard.kpis.overdue).toEqual({ count: 2, amount: "5400.00" });
  });

  it("série mensuelle sur douze mois glissants", () => {
    expect(dashboard.monthly).toHaveLength(12);
    expect(dashboard.monthly[0]).toEqual({ month: "2025-12", revenue: "4000.00", expenses: "0.00" });
    expect(dashboard.monthly.find((m) => m.month === "2026-03")).toEqual({ month: "2026-03", revenue: "3000.00", expenses: "0.00" });
    expect(dashboard.monthly.find((m) => m.month === "2026-10")).toEqual({ month: "2026-10", revenue: "2000.00", expenses: "80.00" });
    expect(dashboard.monthly[11]).toEqual({ month: "2026-11", revenue: "1400.00", expenses: "2055.00" });
  });

  it("répartition des dépenses par catégorie, de la plus élevée à la plus faible", () => {
    expect(dashboard.expensesByCategory.map(({ name, amount }) => [name, amount])).toEqual([
      ["Salaires", "1500.00"],
      ["Loyer et charges locatives", "300.00"],
      ["Télécom et internet", "100.00"],
      ["Non catégorisé", "100.00"],
      ["Frais bancaires", "55.00"],
    ]);
  });

  it("dernières opérations, de la plus récente à la plus ancienne", () => {
    expect(dashboard.latestTransactions).toHaveLength(8);
    expect(dashboard.latestTransactions[0]).toMatchObject({ date: "2026-11-12", label: "VIR SALAIRE", amount: "-1500.00", categoryName: "Salaires" });
    expect(dashboard.latestTransactions.every((t) => t.accountName === "Compte courant")).toBe(true);
  });

  it("alertes et échéances", () => {
    const byId = Object.fromEntries(dashboard.alerts.map((a) => [a.id, a]));
    expect(byId["invoices-overdue"].title).toBe("2 factures en retard de paiement");
    expect(byId["invoices-overdue"].description).toMatch(/5\s400,00/); // espace fine insécable
    expect(byId["purchases-due"].title).toContain("1 facture fournisseur");
    expect(byId["vat-deadline"]).toMatchObject({ dueDate: "2026-11-24" });
    expect(byId["vat-deadline"].title).toContain("octobre 2026");
    expect(byId["fiscal-year-closing"].title).toContain("48 jours");
    expect(byId["transactions-to-review"].title).toBe("1 opération bancaire à catégoriser");
    // 7 décaissements : 1 justifié, 2 hors charges (TVA reversée, virement interne) qui n'appellent pas de justificatif
    expect(byId["transactions-unjustified"].title).toBe("4 dépenses sans justificatif");
    expect(byId["invoices-due-soon"]).toBeUndefined();
  });

  it("recalcule les indicateurs de période pour un autre filtre", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const week = await getDashboard(company, { preset: "7d" }, NOW); // du 07/11 au 13/11
    expect(week.range).toEqual({ preset: "7d", from: "2026-11-07", to: "2026-11-13" });
    expect(week.kpis.periodRevenue).toBe("400.00"); // 500 − 100
    expect(week.kpis.periodExpenses).toBe("1600.00"); // 100 + 1 500
    expect(week.kpis.periodVat).toEqual({ collected: "280.00", deductible: "10.00", net: "270.00" }); // 200 + 100 − 20 ; 10
    // Les indicateurs de situation ne dépendent pas du filtre.
    expect(week.kpis.bankBalance).toBe("7435.00");
    expect(week.kpis.revenueFiscalYear).toBe("6400.00");
  });
});

describe("tableau de bord — isolation et cas limites", () => {
  it("n'agrège jamais les données d'une autre entreprise", async () => {
    const other = await prisma.company.findUniqueOrThrow({ where: { id: otherCompanyId } });
    const otherDashboard = await getDashboard(other, NOVEMBER, NOW);
    expect(otherDashboard.kpis.periodRevenue).toBe("50000.00");
    expect(otherDashboard.kpis.bankBalance).toBe("744444.00");
    expect(otherDashboard.latestTransactions.map((t) => t.label)).toEqual(["GROSSE DEPENSE"]);
    // Et réciproquement, rien de l'autre entreprise dans la première.
    expect(dashboard.latestTransactions.some((t) => t.label === "GROSSE DEPENSE")).toBe(false);
    expect(JSON.stringify(dashboard)).not.toContain("50000");
  });

  it("affiche des zéros, et aucune donnée fictive, pour une entreprise sans activité", async () => {
    const franchise = await prisma.company.findUniqueOrThrow({ where: { id: franchiseCompanyId } });
    const empty = await getDashboard(franchise, {}, NOW);
    expect(empty.isEmpty).toBe(true);
    expect(empty.vatApplicable).toBe(false);
    expect(empty.kpis).toMatchObject({
      revenueMonth: "0.00",
      revenueFiscalYear: "0.00",
      periodRevenue: "0.00",
      periodExpenses: "0.00",
      periodResult: "0.00",
      periodVat: null, // franchise en base
      bankBalance: "0.00",
      availableCash: "0.00",
      unpaid: { count: 0, amount: "0.00" },
      overdue: { count: 0, amount: "0.00" },
    });
    expect(empty.monthly.every((m) => m.revenue === "0.00" && m.expenses === "0.00")).toBe(true);
    expect(empty.expensesByCategory).toEqual([]);
    expect(empty.latestTransactions).toEqual([]);
    expect(empty.alerts.map((a) => a.id)).toEqual(["fiscal-year-closing"]);
  });
});
