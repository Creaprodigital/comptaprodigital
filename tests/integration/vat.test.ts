import { beforeAll, describe, expect, it } from "vitest";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { AppError } from "@/server/http/errors";
import { createBankAccount } from "@/server/modules/bank/accounts";
import { listCategories } from "@/server/modules/bank/categories";
import { createManualTransaction, updateTransaction } from "@/server/modules/bank/transactions";
import { createCustomer } from "@/server/modules/customers/service";
import { createCreditNote, createInvoiceDraft, issueInvoice, recordPayment } from "@/server/modules/invoicing/invoices";
import { createPurchase, linkPurchasePayment } from "@/server/modules/purchases/service";
import { computeVat } from "@/server/modules/vat/compute";
import { getVatPeriod, listVatPeriods, vatPeriodAction, vatPeriodCsv, vatSimulation } from "@/server/modules/vat/service";
import { getEntry } from "@/server/modules/accounting/entries";
import { bankAccountSchema, manualTransactionSchema, transactionUpdateSchema } from "@/lib/schemas/bank";
import { purchaseSchema } from "@/lib/schemas/accounting";
import { customerSchema, invoiceSchema, paymentSchema } from "@/lib/schemas/invoicing";
import { addMonths, endOfMonth, startOfMonth, todayInParis } from "@/lib/dates";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const today = todayInParis();
// Mois précédent : période échue, déclarable.
const month = startOfMonth(addMonths(today, -1));
const day = (n: number) => `${month.slice(0, 8)}${String(n).padStart(2, "0")}`;
const monthEnd = endOfMonth(month);

let userId: string;
let access: CompanyAccess;
let customerId: string;
let bankAccountId: string;

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

async function issue(amount: string, date: string, options: { goods?: boolean; vatRate?: string } = {}) {
  const draft = await createInvoiceDraft(access, userId, invoiceSchema.parse({ customerId, issueDate: date, operationCategory: options.goods ? "GOODS" : "SERVICES", items: [{ description: "Ligne", quantity: "1", unitPriceExclTax: amount, discountRate: "0", vatRate: options.vatRate ?? "20" }] }));
  return issueInvoice(access, userId, draft.id);
}

beforeAll(async () => {
  await resetDatabase();
  const owner = await createVerifiedUser({ email: "tva@exemple.test", plan: "PRO" });
  userId = owner.id;
  const company = await createTestCompany(userId, "Atelier TVA", { vatRegime: "REEL_NORMAL_MENSUEL", vatExigibility: "ENCAISSEMENTS" });
  access = await authorizeCompany(userId, company.id, "vat:validate");
  customerId = (await createCustomer(access, userId, customerSchema.parse({ name: "Maison Verdier" }))).id;
  bankAccountId = (await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte courant" }))).id;
  const categories = await listCategories(company.id);
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;

  // Ventes : un service à l'encaissement (réglé à moitié), un bien sur les débits à 5,5 %, et un avoir.
  const service = await issue("1000", day(3));
  await recordPayment(access, userId, service.id, paymentSchema.parse({ amount: "600", paidAt: day(10), method: "TRANSFER" }));
  const goods = await issue("200", day(5), { goods: true, vatRate: "5.5" });
  const credit = await createCreditNote(access, userId, goods.id, { reason: "Retour" });
  await issueInvoice(access, userId, credit.id);
  // Avoir à l'encaissement après règlement partiel : 600 € déjà encaissés.
  const refund = await createCreditNote(access, userId, service.id, { reason: "Annulation" });
  await issueInvoice(access, userId, refund.id);

  // Achats : un bien (déductible à la facture), un service payé (déductible au paiement), un service non payé.
  await createPurchase(access, userId, purchaseSchema.parse({ label: "Fournitures", issueDate: day(4), categoryId: cat("Fournitures et petit équipement"), operationCategory: "GOODS", totalExclTax: "100", totalVat: "20" }));
  const advice = await createPurchase(access, userId, purchaseSchema.parse({ label: "Conseil", issueDate: day(4), categoryId: cat("Honoraires"), totalExclTax: "500", totalVat: "100" }));
  await createPurchase(access, userId, purchaseSchema.parse({ label: "Loyer", issueDate: day(6), categoryId: cat("Loyer et charges locatives"), totalExclTax: "800", totalVat: "160" }));
  const payment = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: day(12), label: "VIR CONSEIL", direction: "OUT", amount: "600" }));
  await linkPurchasePayment(access, userId, payment.id, advice.id);

  // Banque : une dépense avec TVA, une immobilisation, une vente au comptoir.
  await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: day(14), label: "CB RESTAURANT", direction: "OUT", amount: "110", categoryId: cat("Repas et réceptions"), vatRate: "10" }));
  const computer = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: day(15), label: "ORDINATEUR", direction: "OUT", amount: "1200" }));
  const custom = await prisma.transactionCategory.create({ data: { companyId: company.id, name: "Matériel informatique", kind: "EXPENSE", accountNumber: "218300" } });
  await updateTransaction(access, userId, computer.id, transactionUpdateSchema.parse({ categoryId: custom.id, vatRate: "20" }));
  await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: day(16), label: "VENTE COMPTOIR", direction: "IN", amount: "60", categoryId: cat("Ventes et prestations"), vatRate: "20" }));
});

describe("calcul de la TVA d'une période", () => {
  it("applique l'exigibilité de chaque opération", async () => {
    const vat = await computeVat(access.company.id, month, monthEnd);
    // Collectée : règlement de 600 → 100 ; vente au comptoir → 10 ; bien à 5,5 % sur les débits → 11.
    // Les avoirs, datés du jour de leur émission, relèvent de la période en cours.
    expect(vat.collectedByRate).toEqual([
      { rate: "20", base: "550.00", vat: "110.00" },
      { rate: "5.5", base: "200.00", vat: "11.00" },
    ]);
    expect(vat.collected).toBe("121.00");
    // Déductible : fournitures 20 (facture) + conseil 100 (paiement) + restaurant 10 ; loyer non payé exclu ; ordinateur 200 (immobilisation).
    expect(vat.deductibleGoodsServices).toBe("130.00");
    expect(vat.deductibleAssets).toBe("200.00");
    expect(vat.balance).toBe("-209.00");
    expect(vat.operations.map((o) => `${o.kind}:${o.nature}:${o.vat}`)).toEqual(
      expect.arrayContaining(["PAYMENT:COLLECTED:100.00", "INVOICE:COLLECTED:11.00", "PURCHASE:DEDUCTIBLE:20.00", "PURCHASE_PAYMENT:DEDUCTIBLE:100.00", "BANK:DEDUCTIBLE_ASSETS:200.00", "BANK:COLLECTED:10.00"]),
    );
  });

  it("répartit la TVA des avoirs selon ce qui avait été encaissé", async () => {
    const current = await computeVat(access.company.id, startOfMonth(today), today);
    // Avoir sur le bien (débits) : −11. Avoir total sur le service : 600 € encaissés → −100 de TVA collectée ;
    // les 600 € non encaissés n'avaient pas rendu la TVA exigible.
    expect(current.collectedByRate).toEqual([
      { rate: "20", base: "-500.00", vat: "-100.00" },
      { rate: "5.5", base: "-200.00", vat: "-11.00" },
    ]);
  });

  it("concorde avec les comptes de TVA de la comptabilité", async () => {
    const detail = await getVatPeriod(access, month);
    expect(detail.accountingCheck).toEqual({ collected: "121.00", deductible: "330.00" });
  });
});

describe("déclaration", () => {
  it("liste les périodes mensuelles avec leur échéance", async () => {
    const { periods } = await listVatPeriods(access, Number(month.slice(0, 4)));
    const period = periods.find((p) => p.startDate === month)!;
    expect(period).toMatchObject({ status: "NOT_STARTED", formType: "CA3", ended: true, collected: "121.00", deductible: "330.00", netVatDue: "-209.00" });
    expect(period.dueDate).toBe(`${addMonths(month, 1).slice(0, 7)}-24`);
  });

  it("prépare la CA3 avec ses repères, puis la valide après vérification", async () => {
    await expectAppError(vatPeriodAction(access, userId, month, "validate"), "VAT_NOT_PREPARED");
    await expectAppError(vatPeriodAction(access, userId, startOfMonth(today), "prepare"), "PERIOD_NOT_ENDED");
    const prepared = await vatPeriodAction(access, userId, month, "prepare");
    expect(prepared.period.status).toBe("PREPARED");
    expect(prepared.form.map((f) => [f.line, f.amount])).toEqual([
      ["A1", "750.00"],
      ["08", "110.00"],
      ["09", "11.00"],
      ["16", "121.00"],
      ["19", "200.00"],
      ["20", "130.00"],
      ["22", "0.00"],
      ["23", "330.00"],
      ["25", "209.00"],
    ]);

    const validated = await vatPeriodAction(access, userId, month, "validate");
    expect(validated.period.status).toBe("VALIDATED");
    expect(validated.snapshot).toMatchObject({ netVatDue: "-209.00" });
    expect(validated.history.map((h) => h.detail)).toEqual(["Déclaration préparée (crédit de 209,00 €)", "Déclaration validée (crédit de 209,00 €) — à déposer sur l'espace professionnel"]);

    // Écriture de liquidation au brouillard : TVA collectée soldée, crédit de TVA à reporter.
    const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: access.company.id, sourceType: "VAT_RETURN", sourceId: validated.period.id! } });
    const view = await getEntry(access, entry.id);
    expect(view.lines.map((l) => `${l.accountNumber} ${l.debit !== "0.00" ? `D ${l.debit}` : `C ${l.credit}`}`).sort()).toEqual(["445620 C 200.00", "445660 C 130.00", "445670 D 209.00", "445710 D 121.00"]);
  });

  it("signale une modification postérieure sans toucher à la déclaration validée", async () => {
    const restaurant = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: access.company.id, label: "CB RESTAURANT" } });
    await updateTransaction(access, userId, restaurant.id, transactionUpdateSchema.parse({ vatRate: "20" }));
    const { periods } = await listVatPeriods(access, Number(month.slice(0, 4)));
    const period = periods.find((p) => p.startDate === month)!;
    expect(period).toMatchObject({ status: "VALIDATED", outdated: true, netVatDue: "-209.00" });
    await updateTransaction(access, userId, restaurant.id, transactionUpdateSchema.parse({ vatRate: "10" }));
  });

  it("indique le dépôt, puis interdit de rouvrir une déclaration déposée", async () => {
    await expectAppError(vatPeriodAction(access, userId, month, "prepare"), "VAT_VALIDATED");
    const reopened = await vatPeriodAction(access, userId, month, "reopen");
    expect(reopened.period.status).toBe("PREPARED");
    expect(await prisma.accountingEntry.count({ where: { companyId: access.company.id, sourceType: "VAT_RETURN", status: "DRAFT" } })).toBe(0);
    await vatPeriodAction(access, userId, month, "validate");
    const declared = await vatPeriodAction(access, userId, month, "declare");
    expect(declared.period.status).toBe("DECLARED");
    await expectAppError(vatPeriodAction(access, userId, month, "reopen"), "VAT_DECLARED");
  });

  it("reporte le crédit sur la période suivante et le simule", async () => {
    const simulation = await vatSimulation(access);
    // Période en cours : −111 (avoirs) − 209 (crédit reporté de la déclaration déposée).
    expect(simulation.current).toMatchObject({ startDate: startOfMonth(today), collected: "-111.00", netVatDue: "-320.00" });
    expect(simulation.installments).toBeNull();
  });

  it("exporte le détail des opérations de la période", async () => {
    const { fileName, content } = await vatPeriodCsv(access, month);
    expect(fileName).toBe(`tva-${month}-${monthEnd}.csv`);
    expect(content).toContain("Date;Nature;Opération;Référence;Tiers ou libellé;Taux;Base HT;TVA");
    expect(content).toContain("TVA déductible — immobilisations;Opération bancaire;;ORDINATEUR;20 %;1000,00;200,00");
  });

  it("ne concerne pas les entreprises en franchise en base", async () => {
    const micro = await createVerifiedUser({ email: "micro-tva@exemple.test", plan: "PRO" });
    const company = await createTestCompany(micro.id, "Micro", { legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" });
    const microAccess = await authorizeCompany(micro.id, company.id, "vat:read");
    expect((await listVatPeriods(microAccess)).periods).toEqual([]);
    await expectAppError(getVatPeriod(microAccess, month), "VAT_FRANCHISE");
  });
});
