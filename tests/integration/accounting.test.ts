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
import { autoLetter, bankReconciliation, generalLedger, letterLines, thirdPartyBalances, thirdPartyLines, trialBalance, trialBalanceCsv, unletter } from "@/server/modules/accounting/reports";
import { closeFiscalYear, closingCheck, listFiscalYears, lockPeriod } from "@/server/modules/accounting/closing";
import { createAsset, disposeAsset, getAsset, pendingDepreciations, postDepreciations, updateAsset } from "@/server/modules/accounting/assets";
import { buildFec, checkFec, decodeLatin9, encodeLatin9 } from "@/server/modules/accounting/fec";
import { bankAccountSchema, manualTransactionSchema, reconcileSchema, transactionUpdateSchema } from "@/lib/schemas/bank";
import { fixedAssetSchema, manualEntrySchema, purchaseSchema, supplierSchema } from "@/lib/schemas/accounting";
import { customerSchema, invoiceSchema, paymentSchema } from "@/lib/schemas/invoicing";
import { addDays, toIsoDate as toIso, todayInParis } from "@/lib/dates";
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

describe("états comptables", () => {
  it("produit une balance équilibrée, avec et sans le brouillard", async () => {
    const balance = await trialBalance(access);
    expect(balance.balanced).toBe(true);
    expect(balance.totals.debit).toBe(balance.totals.credit);
    expect(balance.classes.map((c) => c.digit)).toEqual(expect.arrayContaining(["1", "4", "5", "6", "7"]));
    const validatedOnly = await trialBalance(access, { includeDrafts: false });
    expect(validatedOnly.balanced).toBe(true);
    const csv = await trialBalanceCsv(access);
    expect(csv).toContain("Compte;Intitulé;Total débit;Total crédit;Solde débiteur;Solde créditeur");
    expect(csv).toContain("706000;Prestations de services;");
  });

  it("présente le grand livre d'un compte avec son solde progressif", async () => {
    const ledger = await generalLedger(access, { account: "512" });
    expect(ledger.accounts).toHaveLength(1);
    const bank = ledger.accounts[0];
    expect(bank.accountNumber).toBe("512000");
    expect(bank.lines.at(-1)!.balance).toBe(bank.closing);
    // Banque : 1000 (ouverture) − 120 − 600 + 120 = 400
    expect(bank.closing).toBe("400.00");
  });

  it("pagine le grand livre sans fausser soldes progressifs ni totaux", async () => {
    const full = await generalLedger(access, {}, { pageSize: 10_000 });
    const allLines = full.accounts.flatMap((a) => a.lines.map((l) => ({ account: a.accountNumber, ...l })));
    expect(full.pagination.totalLines).toBe(allLines.length);
    // Pages de 2 lignes : la concaténation redonne exactement le grand livre complet.
    const paged: typeof allLines = [];
    for (let page = 1; page <= Math.ceil(allLines.length / 2); page++) {
      const part = await generalLedger(access, {}, { page, pageSize: 2 });
      expect(part.pagination.pages).toBe(Math.ceil(allLines.length / 2));
      for (const account of part.accounts) {
        const reference = full.accounts.find((a) => a.accountNumber === account.accountNumber)!;
        // Totaux et solde de fin : ceux de toute la période, quelle que soit la page.
        expect({ debit: account.debit, credit: account.credit, closing: account.closing }).toEqual({ debit: reference.debit, credit: reference.credit, closing: reference.closing });
        paged.push(...account.lines.map((l) => ({ account: account.accountNumber, ...l })));
      }
    }
    expect(paged).toEqual(allLines);
  });

  it("établit l'état de rapprochement bancaire sans écart", async () => {
    const state = await bankReconciliation(access, bankAccountId, today);
    expect(state).toMatchObject({ bankBalance: "400.00", bookBalance: "400.00", difference: "0.00", missingEntries: [] });
  });

  it("lettre les comptes clients automatiquement et manuellement", async () => {
    await validateDraftsThrough(access, userId, { through: today });
    const before = await thirdPartyBalances(access, "customers");
    expect(before[0]).toMatchObject({ accountNumber: "411000", auxiliaryNumber: "C00001", auxiliaryLabel: "Maison Verdier" });
    const { groups } = await autoLetter(access, userId);
    // Facture sur les débits et son avoir (client) ; facture d'achat et son décaissement (fournisseur).
    expect(groups).toBe(2);
    const lettered = (await thirdPartyLines(access, "411000", "C00001")).filter((l) => l.letter);
    expect(lettered.map((l) => [l.letter, l.debit, l.credit])).toEqual([["A", "600.00", "0.00"], ["A", "0.00", "600.00"]]);
    expect((await thirdPartyLines(access, "401000", "F00001")).every((l) => l.letter === "A")).toBe(true);
    expect((await thirdPartyBalances(access, "suppliers"))[0]).toMatchObject({ auxiliaryLabel: "Cabinet Conseil", balance: "0.00", unletteredLines: 0 });
    const open = (await thirdPartyLines(access, "411000", "C00001")).filter((l) => !l.letter && !l.draft);
    await expectAppError(letterLines(access, userId, open.slice(0, 1).map((l) => l.id)), "VALIDATION_ERROR");
    await unletter(access, userId, "411000", "A");
    expect((await thirdPartyLines(access, "411000", "C00001")).some((l) => l.letter === "A")).toBe(false);
  });
});

describe("immobilisations", () => {
  let assetId: string;

  it("inscrit un bien au registre et calcule son plan", async () => {
    const year = Number(today.slice(0, 4));
    const asset = await createAsset(access, userId, fixedAssetSchema.parse({ label: "Ordinateur portable", assetAccountNumber: "218300", acquisitionDate: `${year}-04-01`, serviceDate: `${year}-04-01`, cost: "3000", method: "LINEAR", durationMonths: 36 }));
    assetId = asset.id;
    expect(asset).toMatchObject({ depreciationAccountNumber: "281830", netBookValue: "3000.00", status: "ACTIVE" });
    expect(asset.plan.map((p) => p.amount)).toEqual(["750.00", "1000.00", "1000.00", "250.00"]);
  });

  it("signale puis comptabilise les dotations de l'exercice", async () => {
    const [current] = await listFiscalYears(access);
    expect(await pendingDepreciations(access, current.id)).toEqual([{ assetId, label: "Ordinateur portable", planned: "750.00", recorded: null }]);
    expect(await postDepreciations(access, userId, current.id)).toEqual({ assets: 1, total: "750.00" });
    expect(await pendingDepreciations(access, current.id)).toEqual([]);
    const [entry] = await entriesFor("DEPRECIATION", current.id);
    expect(lines(entry)).toEqual(["281830 C 750.00", "681100 D 750.00"]);
    expect((await getAsset(access, assetId)).netBookValue).toBe("2250.00");
    await expectAppError(updateAsset(access, userId, assetId, fixedAssetSchema.parse({ label: "Autre", assetAccountNumber: "218300", acquisitionDate: today, serviceDate: today, cost: "1", durationMonths: 12 })), "ASSET_DEPRECIATED");
  });

  it("sort un bien de l'actif avec sa dotation complémentaire et son écriture de cession", async () => {
    const disposed = await disposeAsset(access, userId, assetId, { date: today, salePrice: "1500" });
    expect(disposed.status).toBe("DISPOSED");
    const [entry] = await entriesFor("ASSET_DISPOSAL", assetId);
    const cumulated = disposed.cumulated;
    const net = (3000 - Number(cumulated)).toFixed(2);
    expect(lines(entry)).toEqual([`218300 C 3000.00`, `281830 D ${cumulated}`, "462000 D 1500.00", `675000 D ${net}`, "775000 C 1500.00"].sort());
  });
});

describe("verrouillage, clôture et FEC", () => {
  it("refuse de verrouiller une période qui contient du brouillard", async () => {
    const [current] = await listFiscalYears(access);
    await expectAppError(lockPeriod(access, userId, current.id, today), "DRAFTS_REMAINING");
    await validateDraftsThrough(access, userId, { through: current.endDate });
    const locked = await lockPeriod(access, userId, current.id, d(3));
    expect(locked.lockedThrough).toBe(d(3));
    await expectAppError(lockPeriod(access, userId, current.id, d(5)), "VALIDATION_ERROR");
    const od = (await prisma.accountingJournal.findFirstOrThrow({ where: { companyId: access.company.id, code: "OD" } })).id;
    await expectAppError(createManualEntry(access, userId, manualEntrySchema.parse({ journalId: od, date: d(4), label: "Dans la période verrouillée", lines: [{ accountNumber: "471000", debit: "1" }, { accountNumber: "101300", credit: "1" }] })), "VALIDATION_ERROR");
  });

  it("reporte une correction d'une période verrouillée à la première date ouverte", async () => {
    const tx = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: access.company.id, label: "CB PAPETERIE" } });
    const rent = (await listCategories(access.company.id)).find((c) => c.name === "Loyer et charges locatives")!;
    await updateTransaction(access, userId, tx.id, transactionUpdateSchema.parse({ categoryId: rent.id, vatRate: null }));
    const drafts = (await entriesFor("BANK_TRANSACTION", tx.id)).filter((e) => e.status === "DRAFT");
    expect(drafts.map((e) => e.date)).toEqual([d(2), d(2)]);
    expect(drafts.every((e) => e.pieceDate === d(4))).toBe(true);
    await validateDraftsThrough(access, userId, { through: today });
  });

  it("exporte un FEC conforme à la structure attendue", async () => {
    await prisma.company.update({ where: { id: access.company.id }, data: { siren: "552100554" } });
    access = await authorizeCompany(userId, access.company.id, "accounting:write");
    const [current] = await listFiscalYears(access);
    const fec = await buildFec(access, userId, current.id);
    expect(fec.fileName).toBe(`552100554FEC${current.endDate.replace(/-/g, "")}.txt`);
    expect(fec.provisional).toBe(true);
    const check = checkFec(fec.content);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
    expect(check.totalDebit).toBe(check.totalCredit);
    const text = decodeLatin9(fec.content);
    expect(text.split("\r\n")[0].split("\t")).toHaveLength(18);
    expect(text).toContain("\tVT\t".slice(1)); // journal des ventes présent
    expect(text).toMatch(/\t411000\tClients\tC00001\tMaison Verdier\t/);
    expect(encodeLatin9("Écriture — 12 €").equals(Buffer.from([0xc9, 0x63, 0x72, 0x69, 0x74, 0x75, 0x72, 0x65, 0x20, 0x2d, 0x20, 0x31, 0x32, 0x20, 0xa4]))).toBe(true);
  });

  it("refuse de clôturer un exercice qui n'est pas terminé", async () => {
    const [current] = await listFiscalYears(access);
    expect((await closingCheck(access, current.id)).problems).toEqual([expect.stringContaining("ne peut être clôturé qu'après cette date")]);
    await expectAppError(closeFiscalYear(access, userId, current.id), "CLOSING_NOT_READY");
  });

  it("clôture un exercice terminé et ouvre le suivant par des à-nouveaux", async () => {
    const archivist = await createVerifiedUser({ email: "archives@exemple.test", plan: "PRO" });
    const company = await createTestCompany(archivist.id, "Atelier Archives");
    const archive = await authorizeCompany(archivist.id, company.id, "accounting:close");
    const userId = archivist.id;
    const previousYear = Number(today.slice(0, 4)) - 1;
    const account = await createBankAccount(archive, userId, bankAccountSchema.parse({ name: "Compte courant" }));
    const categories = await listCategories(company.id);
    const sales = categories.find((c) => c.name === "Ventes et prestations")!;
    const fees = categories.find((c) => c.name === "Honoraires")!;
    const inflow = await createManualTransaction(archive, userId, manualTransactionSchema.parse({ bankAccountId: account.id, date: `${previousYear}-06-15`, label: "VIR CLIENT", direction: "IN", amount: "1000", categoryId: sales.id }));
    await createManualTransaction(archive, userId, manualTransactionSchema.parse({ bankAccountId: account.id, date: `${previousYear}-07-01`, label: "VIR AVOCAT", direction: "OUT", amount: "200", categoryId: fees.id }));
    const years = await listFiscalYears(archive);
    const previous = years.find((y) => y.startDate === `${previousYear}-01-01`)!;
    expect(previous).toMatchObject({ status: "OPEN", draftCount: 2 });

    // Une écriture laissée en compte d'attente bloque la clôture.
    const od = (await prisma.accountingJournal.findFirstOrThrow({ where: { companyId: company.id, code: "OD" } })).id;
    await createManualEntry(archive, userId, manualEntrySchema.parse({ journalId: od, date: `${previousYear}-08-01`, label: "Apport à justifier", lines: [{ accountNumber: "512000", debit: "50" }, { accountNumber: "471000", credit: "50" }] }));
    await validateDraftsThrough(archive, userId, { through: previous.endDate });
    expect((await closingCheck(archive, previous.id)).problems).toEqual([expect.stringContaining("compte d'attente 471000")]);
    const reclass = await createManualEntry(archive, userId, manualEntrySchema.parse({ journalId: od, date: `${previousYear}-12-31`, label: "Reclassement : apport en compte courant", lines: [{ accountNumber: "471000", debit: "50" }, { accountNumber: "455000", credit: "50" }] }));
    await validateEntries(archive, userId, [reclass.id]);

    const ready = await closingCheck(archive, previous.id);
    expect(ready).toEqual({ ready: true, problems: [], result: "800.00" });
    const { result, openingEntryId } = await closeFiscalYear(archive, userId, previous.id);
    expect(result).toBe("800.00");
    const after = await listFiscalYears(archive);
    expect(after.find((y) => y.id === previous.id)).toMatchObject({ status: "CLOSED", lockedThrough: previous.endDate });
    const opening = await getEntry(archive, openingEntryId!);
    expect(opening).toMatchObject({ status: "VALIDATED", journal: { code: "AN" }, date: `${previousYear + 1}-01-01` });
    expect(lines(opening)).toEqual(["120000 C 800.00", "455000 C 50.00", "512000 D 850.00"]);
    await expectAppError(closeFiscalYear(archive, userId, previous.id), "CLOSING_NOT_READY");

    // Plus aucune écriture dans l'exercice clôturé ; une correction est reportée sur l'exercice ouvert.
    await expectAppError(createManualEntry(archive, userId, manualEntrySchema.parse({ journalId: od, date: `${previousYear}-12-01`, label: "Trop tard", lines: [{ accountNumber: "471000", debit: "1" }, { accountNumber: "101300", credit: "1" }] })), "VALIDATION_ERROR");
    await updateTransaction(archive, userId, inflow.id, transactionUpdateSchema.parse({ categoryId: categories.find((c) => c.name === "Autres produits")!.id }));
    const corrections = (await prisma.accountingEntry.findMany({ where: { companyId: company.id, sourceType: "BANK_TRANSACTION", sourceId: inflow.id, status: "DRAFT" } })).map((e) => toIso(e.date));
    expect(corrections).toEqual([`${previousYear + 1}-01-01`, `${previousYear + 1}-01-01`]);
  });
});

describe("initialisation", () => {
  it("initialise une seule fois sous accès concurrents et reprend l'historique", async () => {
    const owner = await createVerifiedUser({ email: "concurrence@exemple.test", plan: "PRO" });
    const company = await createTestCompany(owner.id, "Atelier Concurrent");
    const concurrent = await authorizeCompany(owner.id, company.id, "accounting:read");
    // Une facture émise avant toute utilisation de la comptabilité (comptabilisation désactivée le temps de l'émettre).
    await prisma.company.update({ where: { id: company.id }, data: { accountingMode: "CASH_BOOK" } });
    const cashAccess = await authorizeCompany(owner.id, company.id, "invoices:issue");
    const customer = await createCustomer(cashAccess, owner.id, customerSchema.parse({ name: "Client historique" }));
    const draft = await createInvoiceDraft(cashAccess, owner.id, invoiceSchema.parse({ customerId: customer.id, issueDate: d(2), items: [{ description: "Ligne", quantity: "1", unitPriceExclTax: "100", discountRate: "0", vatRate: "20" }] }));
    await issueInvoice(cashAccess, owner.id, draft.id);
    await prisma.company.update({ where: { id: company.id }, data: { accountingMode: "DOUBLE_ENTRY" } });
    const ready = await authorizeCompany(owner.id, company.id, "accounting:read");
    expect(await prisma.accountingAccount.count({ where: { companyId: company.id } })).toBe(0);

    // Consultations simultanées : aucune erreur, une seule initialisation.
    const { listAccounts, listJournals, accountingOverview } = await import("@/server/modules/accounting/chart");
    await Promise.all([listAccounts(ready), listJournals(ready), accountingOverview(ready), listJournals(concurrent)]);
    const journals = await prisma.accountingJournal.findMany({ where: { companyId: company.id } });
    expect(journals.map((j) => j.code).sort()).toEqual(["AC", "AN", "CA", "OD", "VT"]);
    // L'historique a été repris dès la première consultation.
    expect(await prisma.accountingEntry.count({ where: { companyId: company.id, sourceType: "INVOICE", sourceId: draft.id } })).toBe(1);
  });
});
