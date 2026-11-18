import { beforeAll, describe, expect, it } from "vitest";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { AppError } from "@/server/http/errors";
import { createBankAccount } from "@/server/modules/bank/accounts";
import { listCategories } from "@/server/modules/bank/categories";
import { reconcileTransaction, unreconcileTransaction } from "@/server/modules/bank/reconciliation";
import { createManualTransaction, updateTransaction } from "@/server/modules/bank/transactions";
import { createCustomer } from "@/server/modules/customers/service";
import { createCreditNote, createInvoiceDraft, issueInvoice, recordPayment } from "@/server/modules/invoicing/invoices";
import { createPurchase, createSupplier, linkPurchasePayment } from "@/server/modules/purchases/service";
import { createManualEntry, deleteDraftEntry, getEntry, listEntries, reverseEntry, updateManualEntry, validateDraftsThrough, validateEntries, type EntryView } from "@/server/modules/accounting/entries";
import { resyncAll } from "@/server/modules/accounting/sync";
import { bankAccountSchema, manualTransactionSchema, reconcileSchema, transactionUpdateSchema } from "@/lib/schemas/bank";
import { manualEntrySchema, purchaseSchema, supplierSchema } from "@/lib/schemas/accounting";
import { customerSchema, invoiceSchema, paymentSchema } from "@/lib/schemas/invoicing";
import { addDays, todayInParis } from "@/lib/dates";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const today = todayInParis();
const d = (offset: number) => addDays(today, -offset);

let userId: string;
let access: CompanyAccess;
let customerId: string;
let bankAccountId: string;

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

/** Lignes d'une écriture sous une forme lisible : « 411000 C00001 D 1200.00 ». */
const lines = (entry: EntryView) => entry.lines.map((l) => `${l.accountNumber}${l.auxiliaryNumber ? ` ${l.auxiliaryNumber}` : ""} ${l.debit !== "0.00" ? `D ${l.debit}` : `C ${l.credit}`}`).sort();

async function entriesFor(sourceType: string, sourceId: string) {
  const rows = await prisma.accountingEntry.findMany({ where: { companyId: access.company.id, sourceType: sourceType as never, sourceId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return Promise.all(rows.map((r) => getEntry(access, r.id)));
}

async function invoice(amountExclTax: string, options: { vatRate?: string; date?: string; exigibility?: "DEBITS" } = {}) {
  const draft = await createInvoiceDraft(access, userId, invoiceSchema.parse({ customerId, issueDate: options.date ?? d(10), operationCategory: options.exigibility ? "GOODS" : "SERVICES", items: [{ description: "Prestation", quantity: "1", unitPriceExclTax: amountExclTax, discountRate: "0", vatRate: options.vatRate ?? "20" }] }));
  return issueInvoice(access, userId, draft.id);
}

beforeAll(async () => {
  await resetDatabase();
  const owner = await createVerifiedUser({ email: "compta@exemple.test", plan: "PRO", firstName: "Lina" });
  userId = owner.id;
  const company = await createTestCompany(userId, "Atelier Compta", { vatExigibility: "ENCAISSEMENTS" });
  access = await authorizeCompany(userId, company.id, "accounting:write");
  customerId = (await createCustomer(access, userId, customerSchema.parse({ name: "Maison Verdier" }))).id;
  bankAccountId = (await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte courant", openingBalance: "1000", openingBalanceDate: d(60) }))).id;
});

describe("mise en place", () => {
  it("crée le plan comptable, les journaux et un journal par compte bancaire", async () => {
    const accounts = await prisma.accountingAccount.count({ where: { companyId: access.company.id } });
    expect(accounts).toBeGreaterThan(90);
    const journals = await prisma.accountingJournal.findMany({ where: { companyId: access.company.id }, orderBy: { code: "asc" } });
    expect(journals.map((j) => j.code)).toEqual(["AC", "AN", "BQ1", "CA", "OD", "VT"]);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })).accountNumber).toBe("512000");
    const [opening] = await entriesFor("OPENING", bankAccountId);
    expect(opening).toMatchObject({ status: "DRAFT", journal: { code: "AN" }, date: d(60) });
    expect(lines(opening)).toEqual(["471000 C 1000.00", "512000 D 1000.00"]);
  });
});

describe("ventes", () => {
  it("comptabilise une facture à l'encaissement : TVA en attente jusqu'au règlement", async () => {
    const issued = await invoice("1000");
    const [entry] = await entriesFor("INVOICE", issued.id);
    expect(entry).toMatchObject({ status: "DRAFT", journal: { code: "VT" }, date: d(10), pieceRef: issued.number });
    expect(lines(entry)).toEqual(["411000 C00001 D 1200.00", "445810 C 200.00", "706000 C 1000.00"]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).accountNumber).toBe("C00001");

    await recordPayment(access, userId, issued.id, paymentSchema.parse({ amount: "600", paidAt: d(5), method: "CHECK" }));
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: issued.id } });
    const [paymentEntry] = await entriesFor("PAYMENT", payment.id);
    expect(paymentEntry).toMatchObject({ journal: { code: "OD" }, date: d(5) });
    expect(lines(paymentEntry)).toEqual(["411000 C00001 C 600.00", "445710 C 100.00", "445810 D 100.00", "511000 D 600.00"]);
  });

  it("comptabilise une facture sur les débits et un avoir", async () => {
    const issued = await invoice("500", { exigibility: "DEBITS" });
    const [entry] = await entriesFor("INVOICE", issued.id);
    expect(lines(entry)).toEqual(["411000 C00001 D 600.00", "445710 C 100.00", "707000 C 500.00"]);

    const draft = await createCreditNote(access, userId, issued.id, { reason: "Erreur de quantité" });
    const credit = await issueInvoice(access, userId, draft.id);
    const [creditEntry] = await entriesFor("INVOICE", credit.id);
    expect(lines(creditEntry)).toEqual(["411000 C00001 C 600.00", "445710 D 100.00", "707000 D 500.00"]);
  });

  it("répartit la TVA d'un avoir à l'encaissement entre TVA en attente et TVA déjà exigible", async () => {
    const issued = await invoice("1000");
    await recordPayment(access, userId, issued.id, paymentSchema.parse({ amount: "600", paidAt: d(8), method: "CHECK" }));
    const draft = await createCreditNote(access, userId, issued.id, { reason: "Annulation" });
    const credit = await issueInvoice(access, userId, draft.id);
    const [creditEntry] = await entriesFor("INVOICE", credit.id);
    // 600 € restaient à encaisser (TVA en attente 100 €) ; 600 € avaient été encaissés (TVA exigible 100 €).
    expect(lines(creditEntry)).toEqual(["411000 C00001 C 1200.00", "445710 D 100.00", "445810 D 100.00", "706000 D 1000.00"]);
  });
});

describe("banque et achats", () => {
  it("comptabilise une dépense catégorisée avec sa TVA, ou en compte d'attente sans catégorie", async () => {
    const tx = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: d(4), label: "CB PAPETERIE", direction: "OUT", amount: "120" }));
    let [entry] = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(entry.journal.code).toBe("BQ1");
    expect(lines(entry)).toEqual(["471000 D 120.00", "512000 C 120.00"]);

    const supplies = (await listCategories(access.company.id)).find((c) => c.name === "Fournitures et petit équipement")!;
    await updateTransaction(access, userId, tx.id, transactionUpdateSchema.parse({ categoryId: supplies.id, vatRate: "20" }));
    const all = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(all).toHaveLength(1); // brouillard remplacé, pas de contre-passation
    [entry] = all;
    expect(lines(entry)).toEqual(["445660 D 20.00", "512000 C 120.00", "606300 D 100.00"]);
  });

  it("comptabilise une facture d'achat de services et sa TVA au paiement", async () => {
    const supplier = await createSupplier(access, userId, supplierSchema.parse({ name: "Cabinet Conseil" }));
    const fees = (await listCategories(access.company.id)).find((c) => c.name === "Honoraires")!;
    const purchase = await createPurchase(access, userId, purchaseSchema.parse({ supplierId: supplier.id, reference: "H-2026-14", label: "Mission de conseil", issueDate: d(9), categoryId: fees.id, totalExclTax: "500", totalVat: "100" }));
    const [entry] = await entriesFor("PURCHASE", purchase.id);
    expect(entry.journal.code).toBe("AC");
    expect(lines(entry)).toEqual(["401000 F00001 C 600.00", "445820 D 100.00", "622600 D 500.00"]);

    const tx = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: d(3), label: "VIR CABINET CONSEIL H-2026-14", direction: "OUT", amount: "600" }));
    await linkPurchasePayment(access, userId, tx.id, purchase.id);
    const [bankEntry] = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(lines(bankEntry)).toEqual(["401000 F00001 D 600.00", "445660 D 100.00", "445820 C 100.00", "512000 C 600.00"]);
    expect(await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).toMatchObject({ status: "PAID" });
  });

  it("le règlement rapproché passe de « valeurs à l'encaissement » à la banque, sans double comptage", async () => {
    const issued = await invoice("100");
    const tx = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId, date: d(2), label: "VIR MAISON VERDIER", direction: "IN", amount: "120" }));
    let [bankEntry] = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(lines(bankEntry)).toEqual(["471000 C 120.00", "512000 D 120.00"]);

    await reconcileTransaction(access, userId, tx.id, reconcileSchema.parse({ allocations: [{ invoiceId: issued.id, amount: "120" }] }));
    expect(await entriesFor("BANK_TRANSACTION", tx.id)).toEqual([]); // entièrement couvert par le règlement
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: issued.id } });
    const [paymentEntry] = await entriesFor("PAYMENT", payment.id);
    expect(paymentEntry.journal.code).toBe("BQ1");
    expect(lines(paymentEntry)).toEqual(["411000 C00001 C 120.00", "445710 C 20.00", "445810 D 20.00", "512000 D 120.00"]);

    await unreconcileTransaction(access, userId, tx.id);
    expect(await entriesFor("PAYMENT", payment.id)).toEqual([]);
    // Le rapprochement avait classé l'encaissement en ventes : la catégorie est conservée.
    [bankEntry] = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(lines(bankEntry)).toEqual(["512000 D 120.00", "706000 C 120.00"]);
  });
});

describe("validation, intangibilité et corrections", () => {
  it("valide le brouillard dans l'ordre chronologique avec une numérotation continue", async () => {
    const result = await validateDraftsThrough(access, userId, { through: today });
    expect(result.errors).toEqual([]);
    expect(result.validated).toBeGreaterThan(10);
    const validated = await prisma.accountingEntry.findMany({ where: { companyId: access.company.id, status: "VALIDATED" }, orderBy: { entryNumber: "asc" } });
    expect(validated.map((e) => e.entryNumber)).toEqual(validated.map((_, i) => i + 1));
    const dates = validated.map((e) => e.date.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect((await listEntries(access)).draftCount).toBe(0);
  });

  it("ne modifie jamais une écriture validée : une correction de la pièce produit une contre-passation", async () => {
    const tx = (await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: access.company.id, label: "CB PAPETERIE" } }));
    const [original] = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(original.status).toBe("VALIDATED");
    const before = await prisma.accountingEntryLine.findMany({ where: { entryId: original.id }, orderBy: { position: "asc" } });

    const rent = (await listCategories(access.company.id)).find((c) => c.name === "Loyer et charges locatives")!;
    await updateTransaction(access, userId, tx.id, transactionUpdateSchema.parse({ categoryId: rent.id, vatRate: null }));
    const after = await entriesFor("BANK_TRANSACTION", tx.id);
    expect(after.map((e) => e.status)).toEqual(["VALIDATED", "DRAFT", "DRAFT"]);
    expect(await prisma.accountingEntryLine.findMany({ where: { entryId: original.id }, orderBy: { position: "asc" } })).toEqual(before);
    const reversal = after.find((e) => e.reversalOf)!;
    expect(reversal.reversalOf?.id).toBe(original.id);
    expect(lines(reversal)).toEqual(["445660 C 20.00", "512000 D 120.00", "606300 C 100.00"]);
    expect(lines(after.find((e) => !e.reversalOf && e.status === "DRAFT")!)).toEqual(["512000 C 120.00", "613200 D 120.00"]);

    // Revenir à l'état d'origine supprime la correction préparée.
    const supplies = (await listCategories(access.company.id)).find((c) => c.name === "Fournitures et petit équipement")!;
    await updateTransaction(access, userId, tx.id, transactionUpdateSchema.parse({ categoryId: supplies.id, vatRate: "20" }));
    expect((await entriesFor("BANK_TRANSACTION", tx.id)).map((e) => e.status)).toEqual(["VALIDATED"]);

    // Une resynchronisation complète ne change rien.
    expect((await resyncAll(access.company)).changed).toBe(0);
  });

  it("saisit, modifie, valide puis contre-passe une écriture d'opérations diverses", async () => {
    const od = (await prisma.accountingJournal.findFirstOrThrow({ where: { companyId: access.company.id, code: "OD" } })).id;
    await expectAppError(createManualEntry(access, userId, manualEntrySchema.parse({ journalId: od, date: d(1), label: "Déséquilibrée", lines: [{ accountNumber: "471000", debit: "100" }, { accountNumber: "101300", credit: "90" }] })), "VALIDATION_ERROR");
    await expectAppError(createManualEntry(access, userId, manualEntrySchema.parse({ journalId: od, date: d(1), label: "Compte inconnu", lines: [{ accountNumber: "471000", debit: "100" }, { accountNumber: "758999", credit: "100" }] })), "VALIDATION_ERROR");

    const entry = await createManualEntry(access, userId, manualEntrySchema.parse({ journalId: od, date: d(1), label: "Reclassement du solde d'ouverture", lines: [{ accountNumber: "471000", debit: "1000" }, { accountNumber: "101300", credit: "1000" }] }));
    expect(entry).toMatchObject({ status: "DRAFT", number: null, editable: true });
    const edited = await updateManualEntry(access, userId, entry.id, manualEntrySchema.parse({ journalId: od, date: d(1), label: "Reclassement : apport en capital", lines: [{ accountNumber: "471000", debit: "1000" }, { accountNumber: "101300", credit: "1000" }] }));
    expect(edited.label).toBe("Reclassement : apport en capital");

    const { validated } = await validateEntries(access, userId, [entry.id]);
    expect(validated).toBe(1);
    const final = await getEntry(access, entry.id);
    expect(final).toMatchObject({ status: "VALIDATED", editable: false });
    expect(final.number).toBeGreaterThan(1);
    await expectAppError(updateManualEntry(access, userId, entry.id, manualEntrySchema.parse({ journalId: od, date: d(1), label: "Autre", lines: [{ accountNumber: "471000", debit: "1" }, { accountNumber: "101300", credit: "1" }] })), "ENTRY_VALIDATED");
    await expectAppError(deleteDraftEntry(access, userId, entry.id), "ENTRY_VALIDATED");

    const reversal = await reverseEntry(access, userId, entry.id, {});
    expect(reversal).toMatchObject({ status: "DRAFT", reversalOf: { id: entry.id } });
    expect(lines(reversal)).toEqual(["101300 D 1000.00", "471000 C 1000.00"]);
    await expectAppError(reverseEntry(access, userId, entry.id, {}), "ENTRY_ALREADY_REVERSED");
    await deleteDraftEntry(access, userId, reversal.id);
    // Une écriture générée se corrige depuis sa pièce.
    const generated = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: access.company.id, sourceType: "INVOICE", status: "VALIDATED" } });
    await expectAppError(reverseEntry(access, userId, generated.id, {}), "ENTRY_GENERATED");
  });
});
