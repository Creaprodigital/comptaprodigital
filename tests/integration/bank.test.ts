import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import S3rver from "s3rver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { AppError } from "@/server/http/errors";
import { LocalStorage, S3Storage, decryptFile, encryptFile, setStorageForTests } from "@/server/storage";
import { authorizeBank, authorizeDocuments } from "@/server/modules/bank/access";
import { createBankAccount, deleteBankAccount, listBankAccounts, setBankAccountActive, updateBankAccount } from "@/server/modules/bank/accounts";
import { createCategory, createRule, deleteCategory, deleteRule, listCategories, listRules } from "@/server/modules/bank/categories";
import { commitImport, deleteImport, listImports, previewImport } from "@/server/modules/bank/imports";
import { reconcileTransaction, suggestReconciliation, unreconcileTransaction } from "@/server/modules/bank/reconciliation";
import {
  applyRulesToUncategorized,
  bulkCategorize,
  createManualTransaction,
  deleteTransaction,
  dismissDuplicate,
  getTransaction,
  getTransactionDetail,
  listTransactions,
  transactionsCsv,
  updateTransaction,
} from "@/server/modules/bank/transactions";
import {
  deleteDocument,
  exportDocumentsArchive,
  getDocumentContent,
  getDocumentHistory,
  linkDocument,
  listDocuments,
  purgeDeletedDocuments,
  unlinkDocument,
  updateDocument,
  uploadDocument,
} from "@/server/modules/documents/service";
import { createCustomer } from "@/server/modules/customers/service";
import { createInvoiceDraft, deletePayment, getInvoiceDetail, issueInvoice, recordPayment } from "@/server/modules/invoicing/invoices";
import { getDashboard } from "@/server/modules/dashboard/service";
import { bankAccountSchema, categorySchema, documentUpdateSchema, manualTransactionSchema, reconcileSchema, ruleSchema, transactionUpdateSchema } from "@/lib/schemas/bank";
import { customerSchema, invoiceSchema, paymentSchema } from "@/lib/schemas/invoicing";
import { addDays, todayInParis } from "@/lib/dates";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const today = todayInParis();
const fr = (iso: string) => iso.split("-").reverse().join("/");
const d1 = addDays(today, -3);
const d2 = addDays(today, -2);
const d3 = addDays(today, -1);

let userId: string;
let access: CompanyAccess;
let otherAccess: CompanyAccess;
let accountId: string;
let customerId: string;
let telecomId: string;
let storageDir: string;

const file = (text: string) => Buffer.from(text, "utf8");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("contenu d'image de test")]);

const csv = (rows: string[]) => ["Date;Libellé;Débit;Crédit", ...rows].join("\n");
const novemberCsv = () =>
  csv([
    `${fr(d1)};VIR SEPA MAISON VERDIER;;1 200,00`,
    `${fr(d1)};PRLV SEPA OPERATEUR TELECOM;115,20;`,
    `${fr(d2)};CB PAPETERIE CENTRALE;84,90;`,
    `${fr(d2)};CB PAPETERIE CENTRALE;84,90;`,
    `${fr(d3)};FRAIS TENUE DE COMPTE;18,50;`,
  ]);

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

async function issuedInvoice(amountExclTax: string) {
  const draft = await createInvoiceDraft(access, userId, invoiceSchema.parse({ customerId, issueDate: d1, items: [{ description: "Prestation", quantity: "1", unitPriceExclTax: amountExclTax, discountRate: "0", vatRate: "20" }] }));
  return issueInvoice(access, userId, draft.id);
}

beforeAll(async () => {
  await resetDatabase();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "cpd-stockage-"));
  setStorageForTests(new LocalStorage(storageDir));

  const owner = await createVerifiedUser({ email: "banque@exemple.test", plan: "PRO", firstName: "Lina" });
  userId = owner.id;
  const company = await createTestCompany(userId, "Atelier Banque", { siren: "552100554" });
  access = await authorizeCompany(userId, company.id, "bank:write");
  const other = await createVerifiedUser({ email: "autre-banque@exemple.test", plan: "PRO" });
  const otherCompany = await createTestCompany(other.id, "Autre Atelier");
  otherAccess = await authorizeCompany(other.id, otherCompany.id, "bank:write");
  customerId = (await createCustomer(access, userId, customerSchema.parse({ name: "Maison Verdier" }))).id;
  telecomId = (await listCategories(access.company.id)).find((c) => c.name === "Télécom et internet")!.id;
});

afterAll(async () => {
  setStorageForTests(undefined);
  await rm(storageDir, { recursive: true, force: true });
});

describe("comptes bancaires", () => {
  it("crée un compte, chiffre l'IBAN et n'en affiche que la fin", async () => {
    const account = await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte courant", bankName: "Banque de test", iban: "FR76 3000 6000 0112 3456 7890 189", openingBalance: "1 000,00", openingBalanceDate: addDays(today, -30) }));
    accountId = account.id;
    expect(account).toMatchObject({ ibanMasked: "•••• 0189", balance: "1000.00", transactionCount: 0, currency: "EUR" });
    const stored = await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.ibanEncrypted).toMatch(/^v1\./);
    expect(stored.ibanEncrypted).not.toContain("30006");
    expect(JSON.stringify(account)).not.toContain("FR7630006");
  });

  it("refuse un IBAN ou un BIC invalide", () => {
    expect(bankAccountSchema.safeParse({ name: "Compte", iban: "FR76 3000 6000 0112 3456 7890 188" }).success).toBe(false);
    expect(bankAccountSchema.safeParse({ name: "Compte", bic: "ABC" }).success).toBe(false);
    expect(bankAccountSchema.safeParse({ name: "Compte", bic: "agrifrpp" }).success).toBe(true);
  });

  it("conserve l'IBAN lorsqu'il n'est pas ressaisi", async () => {
    const updated = await updateBankAccount(access, userId, accountId, bankAccountSchema.parse({ name: "Compte courant pro", openingBalance: "1000", openingBalanceDate: addDays(today, -30) }));
    expect(updated).toMatchObject({ name: "Compte courant pro", ibanMasked: "•••• 0189" });
  });
});

describe("import de relevés", () => {
  it("prévisualise un CSV sans rien enregistrer", async () => {
    const preview = await previewImport(access, { bankAccountId: accountId, fileName: "novembre.csv", bytes: file(novemberCsv()) });
    expect(preview).toMatchObject({ format: "CSV", ready: true, total: 5, newCount: 5, duplicateCount: 0, issueCount: 0, totalIn: "1200.00", totalOut: "-303.50", alreadyImportedAt: null, period: { from: d1, to: d3 } });
    expect(preview.csv?.mapping).toEqual({ date: 0, label: 1, debit: 2, credit: 3 });
    expect(await prisma.bankTransaction.count({ where: { companyId: access.company.id } })).toBe(0);
  });

  it("importe les opérations, applique les règles et met le solde à jour", async () => {
    await createRule(access, userId, ruleSchema.parse({ name: "Téléphonie", matchType: "CONTAINS", pattern: "opérateur télécom", direction: "OUT", categoryId: telecomId, vatRate: "20" }));
    const result = await commitImport(access, userId, { bankAccountId: accountId, fileName: "novembre.csv", bytes: file(novemberCsv()) });
    expect(result).toMatchObject({ importedCount: 5, duplicateCount: 0, suspectCount: 0, categorizedCount: 1 });

    const list = await listTransactions(access);
    expect(list.total).toBe(5);
    expect(list.totals).toEqual({ inflow: "1200.00", outflow: "-303.50" });
    expect(list.summary).toEqual({ toReview: 4, unjustified: 4, duplicates: 0 });
    const telecom = list.items.find((t) => t.label.includes("TELECOM"))!;
    expect(telecom).toMatchObject({ amount: "-115.20", status: "CATEGORIZED", vatRate: "20", vatAmount: "19.20", manual: false, category: { name: "Télécom et internet" } });
    // Deux paiements identiques le même jour sont deux opérations distinctes.
    expect(list.items.filter((t) => t.label === "CB PAPETERIE CENTRALE")).toHaveLength(2);

    const [account] = await listBankAccounts(access);
    expect(account).toMatchObject({ balance: "1896.50", transactionCount: 5, toReviewCount: 4, lastTransactionDate: d3 });
    const history = (await getTransactionDetail(access, telecom.id)).history;
    expect(history[0].detail).toBe("Catégorie « Télécom et internet » appliquée par la règle « Téléphonie »");
  });

  it("ignore les doublons à la réimportation et n'ajoute que les opérations nouvelles", async () => {
    const again = await previewImport(access, { bankAccountId: accountId, fileName: "novembre-bis.csv", bytes: file(novemberCsv()) });
    expect(again).toMatchObject({ newCount: 0, duplicateCount: 5 });
    expect(again.alreadyImportedAt).not.toBeNull();
    expect(await commitImport(access, userId, { bankAccountId: accountId, fileName: "novembre-bis.csv", bytes: file(novemberCsv()) })).toMatchObject({ importId: null, importedCount: 0, duplicateCount: 5 });

    // Relevé qui recouvre la période et apporte une opération de plus.
    const overlapping = csv([`${fr(d3)};FRAIS TENUE DE COMPTE;18,50;`, `${fr(today)};VIR SEPA LOYER BUREAU;950,00;`]);
    expect(await commitImport(access, userId, { bankAccountId: accountId, fileName: "chevauchement.csv", bytes: file(overlapping) })).toMatchObject({ importedCount: 1, duplicateCount: 1 });
    expect((await listTransactions(access)).total).toBe(6);
    expect((await listImports(access)).map((i) => [i.fileName, i.importedCount, i.duplicateCount])).toEqual([["chevauchement.csv", 1, 1], ["novembre.csv", 5, 0]]);
  });

  it("signale un doublon suspecté lorsque la même opération arrive d'une autre source", async () => {
    const ofx = `<OFX><CURDEF>EUR<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d3.replace(/-/g, "")}<TRNAMT>-18.50<FITID>REF-FRAIS-1<NAME>COTISATION CARTE ET COMPTE</STMTTRN></BANKTRANLIST></OFX>`;
    const preview = await previewImport(access, { bankAccountId: accountId, fileName: "releve.ofx", bytes: file(ofx) });
    expect(preview).toMatchObject({ format: "OFX", newCount: 1, suspectCount: 1 });
    await commitImport(access, userId, { bankAccountId: accountId, fileName: "releve.ofx", bytes: file(ofx) });
    const suspects = await listTransactions(access, { flag: "duplicates" });
    expect(suspects.items.map((t) => t.label)).toEqual(["COTISATION CARTE ET COMPTE"]);
    const detail = await getTransactionDetail(access, suspects.items[0].id);
    expect(detail.similar.map((t) => t.label)).toEqual(["FRAIS TENUE DE COMPTE"]);
    expect(detail.source?.fileName).toBe("releve.ofx");

    // Même référence bancaire : doublon certain, même si le libellé a changé.
    const renamed = ofx.replace("COTISATION CARTE ET COMPTE", "COTISATION");
    expect(await previewImport(access, { bankAccountId: accountId, fileName: "releve2.ofx", bytes: file(renamed) })).toMatchObject({ newCount: 0, duplicateCount: 1 });

    // Le doublon avéré est supprimé ; l'action reste dans le journal d'audit.
    await deleteTransaction(access, userId, suspects.items[0].id);
    expect((await listTransactions(access)).summary.duplicates).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "bank.transaction.delete", entityId: suspects.items[0].id } });
    expect(audit.metadata).toMatchObject({ label: "COTISATION CARTE ET COMPTE", amount: "-18.50" });
  });

  it("refuse les fichiers illisibles, les PDF et les devises étrangères", async () => {
    await expectAppError(previewImport(access, { bankAccountId: accountId, fileName: "releve.pdf", bytes: PDF }), "STATEMENT_UNREADABLE");
    await expectAppError(previewImport(access, { bankAccountId: accountId, fileName: "vide.csv", bytes: file("Date;Libellé;Montant\n") }), "STATEMENT_UNREADABLE");
    await expectAppError(previewImport(access, { bankAccountId: accountId, fileName: "usd.ofx", bytes: file("<OFX><CURDEF>USD<STMTTRN><DTPOSTED>20261101<TRNAMT>-1.00<FITID>1<NAME>X</STMTTRN></OFX>") }), "CURRENCY_MISMATCH");
    await expectAppError(commitImport(access, userId, { bankAccountId: accountId, fileName: "colonnes.csv", bytes: file("A;B\nx;y\nz;w\n") }), "VALIDATION_ERROR");
    // Un compte d'une autre entreprise est introuvable.
    await expectAppError(previewImport(otherAccess, { bankAccountId: accountId, fileName: "novembre.csv", bytes: file(novemberCsv()) }), "NOT_FOUND");
  });

  it("annule un import et retire ses opérations", async () => {
    const extra = csv([`${fr(today)};CB ERREUR DE FICHIER;10,00;`]);
    const result = await commitImport(access, userId, { bankAccountId: accountId, fileName: "erreur.csv", bytes: file(extra) });
    expect(await deleteImport(access, userId, result.importId!)).toEqual({ deleted: 1 });
    expect((await listTransactions(access, { q: "ERREUR" })).total).toBe(0);
    await expectAppError(deleteImport(otherAccess, userId, (await listImports(access))[0].id), "NOT_FOUND");
  });
});

describe("opérations : recherche, catégorisation, historique", () => {
  it("filtre par sens, par texte, par montant et par état", async () => {
    expect((await listTransactions(access, { direction: "IN" })).items.map((t) => t.label)).toEqual(["VIR SEPA MAISON VERDIER"]);
    expect((await listTransactions(access, { q: "papeterie" })).total).toBe(2);
    expect((await listTransactions(access, { q: "115,20" })).items.map((t) => t.amount)).toEqual(["-115.20"]);
    expect((await listTransactions(access, { status: "CATEGORIZED" })).total).toBe(1);
    expect((await listTransactions(access, { categoryId: "none" })).total).toBe(5);
    expect((await listTransactions(access, { from: d2, to: d2 })).total).toBe(2);
    expect((await listTransactions(access, { accountId: "inconnu" })).total).toBe(0);
    expect((await listTransactions(otherAccess)).total).toBe(0);
  });

  it("catégorise une opération, calcule la TVA et trace chaque modification", async () => {
    const fees = (await listTransactions(access, { q: "FRAIS TENUE" })).items[0];
    const bankFees = (await listCategories(access.company.id)).find((c) => c.name === "Frais bancaires")!;
    const updated = await updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ categoryId: bankFees.id, vatRate: "20", label: "Frais de tenue de compte", notes: "Forfait mensuel" }));
    expect(updated).toMatchObject({ status: "CATEGORIZED", label: "Frais de tenue de compte", rawLabel: "FRAIS TENUE DE COMPTE", vatRate: "20", vatAmount: "3.08", notes: "Forfait mensuel", category: { name: "Frais bancaires" } });

    const cleared = await updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ vatRate: null }));
    expect(cleared).toMatchObject({ vatRate: null, vatAmount: null });
    // Sans changement réel, rien n'est journalisé.
    await updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ label: "Frais de tenue de compte" }));

    const { history } = await getTransactionDetail(access, fees.id);
    expect(history.map((h) => h.detail)).toEqual([
      "Libellé : « FRAIS TENUE DE COMPTE » → « Frais de tenue de compte » · Note modifiée · Catégorie : aucune → « Frais bancaires » · TVA : 20 %",
      "TVA retirée",
    ]);
    expect(history[0].actor).toBe("Lina Martin");
  });

  it("protège la date et le montant des opérations importées", async () => {
    const fees = (await listTransactions(access, { q: "tenue de compte" })).items[0];
    await expectAppError(updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ amount: "20,00", direction: "OUT" })), "BANK_DATA_IMMUTABLE");
    await expectAppError(updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ date: d1 })), "BANK_DATA_IMMUTABLE");
    await expectAppError(updateTransaction(otherAccess, userId, fees.id, transactionUpdateSchema.parse({ notes: "intrusion" })), "NOT_FOUND");
    await expectAppError(updateTransaction(access, userId, fees.id, transactionUpdateSchema.parse({ categoryId: "categorie-inconnue" })), "VALIDATION_ERROR");
  });

  it("saisit une opération à la main, modifiable ensuite", async () => {
    const manual = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d2, label: "Retrait espèces", direction: "OUT", amount: "60" }));
    expect(manual).toMatchObject({ amount: "-60.00", status: "TO_REVIEW", manual: true, isDuplicateSuspect: false });
    const edited = await updateTransaction(access, userId, manual.id, transactionUpdateSchema.parse({ amount: "80", direction: "OUT", date: d3 }));
    expect(edited).toMatchObject({ amount: "-80.00", date: d3 });
    await expectAppError(createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: addDays(today, 2), label: "Futur", direction: "IN", amount: "1" })), "VALIDATION_ERROR");

    // Une saisie de même date et de même montant qu'une opération existante est signalée, puis confirmée.
    const twin = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d3, label: "Retrait distributeur", direction: "OUT", amount: "80" }));
    expect(twin.isDuplicateSuspect).toBe(true);
    expect((await dismissDuplicate(access, userId, twin.id)).isDuplicateSuspect).toBe(false);
    await deleteTransaction(access, userId, twin.id);
    await deleteTransaction(access, userId, manual.id);
  });

  it("catégorise une sélection et applique les règles aux opérations en attente", async () => {
    const supplies = (await listCategories(access.company.id)).find((c) => c.name === "Fournitures et petit équipement")!;
    const stationery = (await listTransactions(access, { q: "papeterie" })).items;
    expect(await bulkCategorize(access, userId, { ids: stationery.map((t) => t.id), categoryId: supplies.id, vatRate: "20" })).toEqual({ updated: 2 });
    expect((await getTransaction(access, stationery[0].id)).vatAmount).toBe("14.15");
    await expectAppError(bulkCategorize(access, userId, { ids: [stationery[0].id, "inconnue"], categoryId: supplies.id }), "NOT_FOUND");

    const rent = (await listCategories(access.company.id)).find((c) => c.name === "Loyer et charges locatives")!;
    await createRule(access, userId, ruleSchema.parse({ name: "Loyer", matchType: "STARTS_WITH", pattern: "VIR SEPA LOYER", direction: "OUT", amountMin: "500", categoryId: rent.id }));
    expect(await applyRulesToUncategorized(access, userId)).toEqual({ examined: 2, categorized: 1 });
    expect((await listTransactions(access, { q: "loyer" })).items[0]).toMatchObject({ status: "CATEGORIZED", category: { name: "Loyer et charges locatives" } });
    // Une seconde application ne change rien.
    expect(await applyRulesToUncategorized(access, userId)).toEqual({ examined: 1, categorized: 0 });
  });

  it("gère les catégories propres à l'entreprise et les règles", async () => {
    const custom = await createCategory(access, userId, categorySchema.parse({ name: "Formation", kind: "EXPENSE", accountNumber: "633300", color: "#2563EB" }));
    expect(custom).toMatchObject({ system: false, accountNumber: "633300", color: "#2563eb" });
    await expectAppError(createCategory(access, userId, categorySchema.parse({ name: "formation", kind: "EXPENSE" })), "VALIDATION_ERROR");
    await expectAppError(createCategory(access, userId, categorySchema.parse({ name: "Honoraires", kind: "EXPENSE" })), "VALIDATION_ERROR");
    // Invisible et inutilisable depuis une autre entreprise.
    expect((await listCategories(otherAccess.company.id)).some((c) => c.name === "Formation")).toBe(false);
    await expectAppError(createRule(otherAccess, userId, ruleSchema.parse({ name: "Intrusion", pattern: "formation", categoryId: custom.id })), "VALIDATION_ERROR");
    // Une catégorie commune n'est pas modifiable.
    await expectAppError(deleteCategory(access, userId, telecomId), "NOT_FOUND");

    const rule = await createRule(access, userId, ruleSchema.parse({ name: "Organisme de formation", pattern: "CAMPUS PRO", categoryId: custom.id }));
    await expectAppError(deleteCategory(access, userId, custom.id), "CATEGORY_HAS_RULES");
    await deleteRule(access, userId, rule.id);
    expect(await deleteCategory(access, userId, custom.id)).toEqual({ deleted: true });
    expect((await listRules(access)).map((r) => r.name)).toEqual(["Téléphonie", "Loyer"]);
    expect(ruleSchema.safeParse({ name: "Regex", matchType: "REGEX", pattern: "(a+)+$", categoryId: telecomId }).success).toBe(false);
    expect(ruleSchema.safeParse({ name: "Bornes", pattern: "abc", categoryId: telecomId, amountMin: "10", amountMax: "5" }).success).toBe(false);
  });

  it("exporte les opérations filtrées en CSV", async () => {
    const lines = (await transactionsCsv(access, { direction: "OUT" })).trim().split("\r\n");
    expect(lines[0]).toBe("Date;Compte;Libellé;Montant;Catégorie;Taux de TVA;TVA;Statut;Justificatifs;Note");
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.includes("TELECOM"))).toBe(`${d1};Compte courant pro;PRLV SEPA OPERATEUR TELECOM;-115,20;Télécom et internet;20,00;19,20;Catégorisée;0;`);
  });
});

describe("documents et justificatifs", () => {
  let documentId: string;
  let telecomTransactionId: string;

  it("enregistre un justificatif chiffré et l'associe à une opération", async () => {
    telecomTransactionId = (await listTransactions(access, { q: "telecom" })).items[0].id;
    const { document, duplicate } = await uploadDocument(access, userId, { fileName: "facture-operateur-novembre.pdf", bytes: PDF, category: "PURCHASE_INVOICE", documentDate: d1, link: { entityType: "BANK_TRANSACTION", entityId: telecomTransactionId } });
    documentId = document.id;
    expect(duplicate).toBe(false);
    expect(document).toMatchObject({ name: "facture-operateur-novembre", mimeType: "application/pdf", sizeBytes: PDF.length, category: "PURCHASE_INVOICE", documentDate: d1, uploadedBy: "Lina Martin", locked: false });
    expect(document.links).toHaveLength(1);
    expect(document.links[0]).toMatchObject({ entityType: "BANK_TRANSACTION", href: `/app/banque/operations/${telecomTransactionId}` });

    // L'opération est justifiée : rapprochée, et sortie de la liste des dépenses sans justificatif.
    expect(await getTransaction(access, telecomTransactionId)).toMatchObject({ status: "RECONCILED", documentCount: 1 });
    expect((await listTransactions(access, { flag: "unjustified" })).items.some((t) => t.id === telecomTransactionId)).toBe(false);
    const detail = await getTransactionDetail(access, telecomTransactionId);
    expect(detail.documents.map((d) => d.id)).toEqual([documentId]);
    expect(detail.history.at(-1)?.detail).toBe("Justificatif « facture-operateur-novembre » associé");

    // Sur le disque, le fichier est chiffré.
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(stored.storageKey.startsWith(`${access.company.id}/`)).toBe(true);
    const raw = await readFile(path.join(storageDir, ...stored.storageKey.split("/")));
    expect(raw.subarray(0, 4).toString()).toBe("CPD1");
    expect(raw.includes(Buffer.from("%PDF"))).toBe(false);
    expect(raw.includes(Buffer.from("Catalog"))).toBe(false);
  });

  it("restitue le contenu d'origine et journalise les téléchargements", async () => {
    const { bytes, document } = await getDocumentContent(access, userId, documentId, { download: true });
    expect(bytes.equals(PDF)).toBe(true);
    expect(document.checksumSha256).toHaveLength(64);
    expect((await getDocumentHistory(access, documentId)).map((h) => h.action)).toEqual(["document.upload", "document.link", "document.download"]);
  });

  it("vérifie le type réel des fichiers", async () => {
    await expectAppError(uploadDocument(access, userId, { fileName: "facture.pdf", bytes: Buffer.from("MZ\u0090\u0000 programme déguisé") }), "UNSUPPORTED_FILE_TYPE");
    await expectAppError(uploadDocument(access, userId, { fileName: "page.png", bytes: Buffer.from("<html><script>alert(1)</script></html>") }), "UNSUPPORTED_FILE_TYPE");
    await expectAppError(uploadDocument(access, userId, { fileName: "gros.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) }), "FILE_TOO_LARGE");
    const image = await uploadDocument(access, userId, { fileName: "ticket restaurant.PNG", bytes: PNG, category: "RECEIPT" });
    expect(image.document).toMatchObject({ mimeType: "image/png", name: "ticket restaurant", links: [] });
  });

  it("ne stocke pas deux fois le même fichier", async () => {
    const stationery = (await listTransactions(access, { q: "papeterie" })).items[0];
    const again = await uploadDocument(access, userId, { fileName: "copie.pdf", bytes: PDF, link: { entityType: "BANK_TRANSACTION", entityId: stationery.id } });
    expect(again.duplicate).toBe(true);
    expect(again.document.id).toBe(documentId);
    expect(again.document.links).toHaveLength(2);
    expect(await prisma.document.count({ where: { companyId: access.company.id, deletedAt: null } })).toBe(2);
    await unlinkDocument(access, userId, documentId, again.document.links.find((l) => l.entityId === stationery.id)!.id);
    expect(await getTransaction(access, stationery.id)).toMatchObject({ status: "CATEGORIZED", documentCount: 0 });
  });

  it("recherche, classe et renomme les documents", async () => {
    expect((await listDocuments(access, { q: "operateur" })).items.map((d) => d.id)).toEqual([documentId]);
    expect((await listDocuments(access, { category: "RECEIPT" })).total).toBe(1);
    expect((await listDocuments(access, { link: "unlinked" })).items.map((d) => d.name)).toEqual(["ticket restaurant"]);
    expect((await listDocuments(access, { from: d1, to: d1 })).total).toBe(1);
    const all = await listDocuments(access);
    expect(all.summary).toMatchObject({ total: 2, unlinked: 1, byCategory: { PURCHASE_INVOICE: 1, RECEIPT: 1 }, sizeBytes: PDF.length + PNG.length });

    const renamed = await updateDocument(access, userId, documentId, documentUpdateSchema.parse({ name: "Facture opérateur novembre", category: "PURCHASE_INVOICE", documentDate: d2 }));
    expect(renamed).toMatchObject({ name: "Facture opérateur novembre", documentDate: d2 });
    expect((await getDocumentHistory(access, documentId)).at(-1)?.detail).toContain("Nom : « facture-operateur-novembre » → « Facture opérateur novembre »");
  });

  it("cloisonne les documents entre entreprises", async () => {
    await expectAppError(getDocumentContent(otherAccess, userId, documentId), "NOT_FOUND");
    await expectAppError(deleteDocument(otherAccess, userId, documentId), "NOT_FOUND");
    expect((await listDocuments(otherAccess)).total).toBe(0);
    // Un document ne peut pas être associé à l'opération d'une autre entreprise.
    const foreign = await uploadDocument(otherAccess, userId, { fileName: "autre.pdf", bytes: PDF });
    expect(foreign.duplicate).toBe(false); // même fichier, mais une autre entreprise : aucun partage
    await expectAppError(linkDocument(otherAccess, userId, foreign.document.id, { entityType: "BANK_TRANSACTION", entityId: telecomTransactionId }), "NOT_FOUND");
    await expectAppError(uploadDocument(otherAccess, userId, { fileName: "autre2.png", bytes: PNG, link: { entityType: "INVOICE", entityId: "facture-inconnue" } }), "NOT_FOUND");
    expect(await prisma.document.count({ where: { companyId: otherAccess.company.id } })).toBe(1);
  });

  it("exporte une archive ZIP classée par catégorie, avec son index", async () => {
    const { zip, count, fileName } = await exportDocumentsArchive(access, userId, {});
    expect(count).toBe(2);
    expect(fileName).toMatch(/^documents-\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = unzipSync(new Uint8Array(zip));
    expect(Object.keys(entries).sort()).toEqual([`Factures d'achat/${d2}_Facture opérateur novembre.pdf`, "Reçus et tickets/ticket restaurant.png", "index.csv"]);
    expect(Buffer.from(entries[`Factures d'achat/${d2}_Facture opérateur novembre.pdf`]).equals(PDF)).toBe(true);
    const index = Buffer.from(entries["index.csv"]).toString("utf8");
    expect(index).toContain("Fichier;Catégorie;Date du document;Nom d'origine;Taille (octets);Empreinte SHA-256;Ajouté le;Associé à");
    expect(index).toContain("PRLV SEPA OPERATEUR TELECOM");
    await expectAppError(exportDocumentsArchive(access, userId, { category: "LEGAL" }), "NOTHING_TO_EXPORT");
  });

  it("supprime un document, libère l'opération puis purge le fichier après le délai", async () => {
    await deleteDocument(access, userId, documentId);
    expect(await getTransaction(access, telecomTransactionId)).toMatchObject({ status: "CATEGORIZED", documentCount: 0 });
    await expectAppError(getDocumentContent(access, userId, documentId), "NOT_FOUND");
    expect((await listDocuments(access)).total).toBe(1);

    const stored = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    const filePath = path.join(storageDir, ...stored.storageKey.split("/"));
    expect(await purgeDeletedDocuments()).toBe(0); // supprimé à l'instant : conservé
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) } });
    expect(await purgeDeletedDocuments()).toBe(1);
    await expect(readFile(filePath)).rejects.toThrow();
    expect(await prisma.document.findUnique({ where: { id: documentId } })).toBeNull();
  });

  it("chiffre de façon authentifiée et fonctionne sur un stockage compatible S3", async () => {
    const encrypted = encryptFile("entreprise/2026/abc", PDF);
    expect(decryptFile("entreprise/2026/abc", encrypted).equals(PDF)).toBe(true);
    expect(() => decryptFile("autre-entreprise/2026/abc", encrypted)).toThrow(); // un objet déplacé est rejeté
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptFile("entreprise/2026/abc", tampered)).toThrow();

    const directory = await mkdtemp(path.join(os.tmpdir(), "cpd-s3-"));
    const server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory, configureBuckets: [{ name: "documents-test", configs: [] }] });
    const { port } = await server.run();
    try {
      const s3 = new S3Storage({ endpoint: `http://127.0.0.1:${port}`, region: "us-east-1", bucket: "documents-test", accessKeyId: "S3RVER", secretAccessKey: "S3RVER", forcePathStyle: true });
      expect(await s3.get("entreprise/2026/absent")).toBeNull();
      await s3.put("entreprise/2026/abc", encrypted);
      expect((await s3.get("entreprise/2026/abc"))?.equals(encrypted)).toBe(true);
      await s3.delete("entreprise/2026/abc");
      expect(await s3.get("entreprise/2026/abc")).toBeNull();
      await expect(s3.put("../evasion", encrypted)).rejects.toThrow("Clé de stockage invalide");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
    await expect(new LocalStorage(storageDir).put("a/../../evasion", PDF)).rejects.toThrow("Clé de stockage invalide");
  });
});

describe("rapprochement avec les factures", () => {
  let inflowId: string;

  it("archive l'original d'une facture à son émission", async () => {
    const invoice = await issuedInvoice("1000");
    const detail = await getInvoiceDetail(access, invoice.id);
    expect(detail.pdfDocumentId).not.toBeNull();
    const { bytes, document } = await getDocumentContent(access, userId, detail.pdfDocumentId!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(document).toMatchObject({ category: "SALES_INVOICE", mimeType: "application/pdf" });
    const view = (await listDocuments(access, { category: "SALES_INVOICE" })).items[0];
    expect(view).toMatchObject({ locked: true, links: [{ entityType: "INVOICE", label: `Facture ${invoice.number}`, href: `/app/factures/${invoice.id}` }] });
    await expectAppError(deleteDocument(access, userId, view.id), "DOCUMENT_LOCKED");
    await expectAppError(updateDocument(access, userId, view.id, documentUpdateSchema.parse({ name: "Autre nom", category: "OTHER" })), "DOCUMENT_LOCKED");
    await expectAppError(unlinkDocument(access, userId, view.id, view.links[0].id), "DOCUMENT_LOCKED");
  });

  it("propose les factures correspondant à un encaissement", async () => {
    inflowId = (await listTransactions(access, { direction: "IN" })).items[0].id;
    const invoice = (await prisma.invoice.findFirstOrThrow({ where: { companyId: access.company.id, status: "ISSUED" } }));
    const suggestions = await suggestReconciliation(access, await getTransaction(access, inflowId));
    expect(suggestions.available).toBe("1200.00");
    expect(suggestions.invoices[0]).toMatchObject({ invoiceId: invoice.id, remaining: "1200.00", proposed: "1200.00", reasons: ["Montant identique", "Nom du client dans le libellé"] });
    // Un décaissement ne se rapproche pas d'une facture de vente.
    const outflow = (await listTransactions(access, { direction: "OUT" })).items[0];
    expect((await suggestReconciliation(access, outflow)).invoices).toEqual([]);
    await expectAppError(reconcileTransaction(access, userId, outflow.id, reconcileSchema.parse({ allocations: [{ invoiceId: invoice.id, amount: "10" }] })), "NOT_AN_INFLOW");
  });

  it("rapproche l'encaissement : la facture est soldée par un règlement lié à l'opération", async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { companyId: access.company.id, status: "ISSUED" } });
    await expectAppError(reconcileTransaction(access, userId, inflowId, reconcileSchema.parse({ allocations: [{ invoiceId: invoice.id, amount: "1200.01" }] })), "VALIDATION_ERROR");
    await expectAppError(reconcileTransaction(otherAccess, userId, inflowId, reconcileSchema.parse({ allocations: [{ invoiceId: invoice.id, amount: "1200" }] })), "NOT_FOUND");

    const reconciled = await reconcileTransaction(access, userId, inflowId, reconcileSchema.parse({ allocations: [{ invoiceId: invoice.id, amount: "1200" }] }));
    expect(reconciled).toMatchObject({ status: "RECONCILED", allocated: "1200.00", category: { name: "Ventes et prestations" } });
    const paid = await getInvoiceDetail(access, invoice.id);
    expect(paid).toMatchObject({ status: "PAID" });
    expect(paid.amountPaid.toFixed(2)).toBe("1200.00");
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ bankTransactionId: inflowId, createdFromBank: true, method: "TRANSFER" });

    const detail = await getTransactionDetail(access, inflowId);
    expect(detail.payments).toEqual([{ id: paid.payments[0].id, amount: "1200.00", invoiceId: invoice.id, invoiceNumber: invoice.number, customerName: "Maison Verdier", createdFromBank: true }]);
    expect(detail.history.at(-1)?.detail).toBe(`Rapprochement : 1200,00 € sur la facture ${invoice.number}`);

    // Tant que le rapprochement existe, ni le règlement ni l'opération ne se suppriment, et rien de plus ne s'affecte.
    await expectAppError(deletePayment(access, userId, invoice.id, paid.payments[0].id), "PAYMENT_RECONCILED");
    await expectAppError(deleteTransaction(access, userId, inflowId), "TRANSACTION_RECONCILED");
    const second = await issuedInvoice("100");
    await expectAppError(reconcileTransaction(access, userId, inflowId, reconcileSchema.parse({ allocations: [{ invoiceId: second.id, amount: "120" }] })), "VALIDATION_ERROR");
  });

  it("annule le rapprochement et remet la facture dans son état antérieur", async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { companyId: access.company.id, status: "PAID" } });
    const undone = await unreconcileTransaction(access, userId, inflowId);
    expect(undone).toMatchObject({ status: "CATEGORIZED", allocated: "0.00" });
    const reopened = await getInvoiceDetail(access, invoice.id);
    expect(reopened).toMatchObject({ status: "ISSUED", paidAt: null });
    expect(reopened.amountPaid.toFixed(2)).toBe("0.00");
    expect(reopened.payments).toHaveLength(0);
    await expectAppError(unreconcileTransaction(access, userId, inflowId), "NOT_RECONCILED");
  });

  it("répartit un encaissement sur plusieurs factures et reprend un règlement déjà saisi", async () => {
    const [small, big] = await prisma.invoice.findMany({ where: { companyId: access.company.id, status: "ISSUED" }, orderBy: { totalInclTax: "asc" } });
    // Le règlement de la petite facture avait été saisi à la main avant l'import du relevé.
    await recordPayment(access, userId, small.id, paymentSchema.parse({ amount: "120", paidAt: d1, method: "TRANSFER" }));
    const manualPayment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: small.id } });
    const suggestions = await suggestReconciliation(access, await getTransaction(access, inflowId));
    expect(suggestions.payments).toEqual([{ paymentId: manualPayment.id, invoiceId: small.id, invoiceNumber: small.number, customerName: "Maison Verdier", amount: "120.00", paidAt: d1, exact: false }]);

    const reconciled = await reconcileTransaction(access, userId, inflowId, reconcileSchema.parse({ allocations: [{ paymentId: manualPayment.id }, { invoiceId: big.id, amount: "1080" }] }));
    expect(reconciled).toMatchObject({ status: "RECONCILED", allocated: "1200.00" });
    // Le règlement saisi à la main n'est pas compté deux fois.
    expect((await getInvoiceDetail(access, small.id)).amountPaid.toFixed(2)).toBe("120.00");
    expect(await getInvoiceDetail(access, big.id)).toMatchObject({ status: "PARTIALLY_PAID" });

    await unreconcileTransaction(access, userId, inflowId);
    // Le règlement manuel reste sur sa facture ; celui créé par le rapprochement disparaît.
    expect(await getInvoiceDetail(access, small.id)).toMatchObject({ status: "PAID" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: manualPayment.id } })).bankTransactionId).toBeNull();
    expect(await getInvoiceDetail(access, big.id)).toMatchObject({ status: "ISSUED" });
    expect((await getTransaction(access, inflowId)).status).toBe("CATEGORIZED");
  });

  it("refuse deux fois la même facture et un rapprochement antérieur à la facture", async () => {
    const big = await prisma.invoice.findFirstOrThrow({ where: { companyId: access.company.id, status: "ISSUED" } });
    expect(reconcileSchema.safeParse({ allocations: [] }).success).toBe(false);
    await expectAppError(reconcileTransaction(access, userId, inflowId, { allocations: [{ invoiceId: big.id, amount: "10.00" }, { invoiceId: big.id, amount: "10.00" }] }), "VALIDATION_ERROR");
    const early = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: addDays(d1, -5), label: "Virement anticipé", direction: "IN", amount: "50" }));
    await expectAppError(reconcileTransaction(access, userId, early.id, reconcileSchema.parse({ allocations: [{ invoiceId: big.id, amount: "50" }] })), "VALIDATION_ERROR");
    await deleteTransaction(access, userId, early.id);
  });
});

describe("accès, formules et tableau de bord", () => {
  it("réserve la banque et les documents aux formules qui les incluent", async () => {
    const starter = await createVerifiedUser({ email: "starter-banque@exemple.test", plan: "STARTER" });
    const company = await createTestCompany(starter.id, "Micro Starter", { legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" });
    await expectAppError(authorizeBank(starter.id, company.id, "bank:read"), "PLAN_FEATURE_UNAVAILABLE");
    await expectAppError(authorizeDocuments(starter.id, company.id, "documents:read"), "PLAN_FEATURE_UNAVAILABLE");
    expect((await authorizeBank(userId, access.company.id, "bank:write")).company.id).toBe(access.company.id);
    // Un non-membre ne découvre pas l'existence de l'entreprise.
    await expectAppError(authorizeBank(starter.id, access.company.id, "bank:read"), "NOT_FOUND");
  });

  it("archive un compte sans perdre ses opérations", async () => {
    await expectAppError(deleteBankAccount(access, userId, accountId), "ACCOUNT_HAS_TRANSACTIONS");
    const spare = await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Livret" }));
    await deleteBankAccount(access, userId, spare.id);
    expect((await setBankAccountActive(access, userId, accountId, false)).isActive).toBe(false);
    expect(await listBankAccounts(access)).toEqual([]);
    expect(await listBankAccounts(access, { includeInactive: true })).toHaveLength(1);
    await expectAppError(commitImport(access, userId, { bankAccountId: accountId, fileName: "novembre.csv", bytes: file(novemberCsv()) }), "ACCOUNT_ARCHIVED");
    await setBankAccountActive(access, userId, accountId, true);
  });

  it("alimente le tableau de bord avec les seules dépenses réellement à justifier", async () => {
    const unjustified = await listTransactions(access, { flag: "unjustified" });
    const dashboard = await getDashboard(access.company, { preset: "month" });
    const alert = dashboard.alerts.find((a) => a.id === "transactions-unjustified");
    expect(alert?.title).toBe(`${unjustified.total} dépenses sans justificatif`);
    expect(unjustified.total).toBe(5);
    // Classée en impôts, une opération n'appelle plus de justificatif.
    const tax = (await listCategories(access.company.id)).find((c) => c.name === "Impôts et taxes")!;
    await updateTransaction(access, userId, unjustified.items[0].id, transactionUpdateSchema.parse({ categoryId: tax.id }));
    expect((await listTransactions(access, { flag: "unjustified" })).total).toBe(4);
    expect((await getDashboard(access.company, { preset: "month" })).alerts.find((a) => a.id === "transactions-unjustified")?.title).toBe("4 dépenses sans justificatif");
    expect((await readdir(storageDir)).sort()).toEqual([access.company.id, otherAccess.company.id].sort());
  });
});
