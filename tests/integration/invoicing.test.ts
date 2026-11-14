import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { createCustomer, customersCsv, listCustomers, setCustomerArchived } from "@/server/modules/customers/service";
import { createProduct, createVatRate, deleteVatRate, listVatRates } from "@/server/modules/products/service";
import {
  createCreditNote,
  createInvoiceDraft,
  deleteInvoiceDraft,
  deletePayment,
  getInvoiceDetail,
  getInvoiceHistory,
  invoicesCsv,
  issueInvoice,
  listInvoices,
  recordPayment,
  serializeInvoice,
  updateInvoiceDraft,
} from "@/server/modules/invoicing/invoices";
import { convertQuote, createQuote, getQuoteDetail, listQuotes, setQuoteStatus, updateQuote } from "@/server/modules/invoicing/quotes";
import { buildInvoiceDocument, buildQuoteDocument } from "@/server/modules/invoicing/document-model";
import { renderDocumentPdf } from "@/server/modules/invoicing/pdf";
import { runAutomaticReminders, sendInvoiceByEmail, sendQuoteByEmail, sendReminder } from "@/server/modules/invoicing/sending";
import { createRecurringInvoice, listRecurringInvoices, nextOccurrence, runRecurringInvoices, setRecurringStatus } from "@/server/modules/invoicing/recurring";
import { getBillingSettings, getLogo, saveLogo, updateBillingSettings } from "@/server/modules/invoicing/settings";
import { getDashboard } from "@/server/modules/dashboard/service";
import { billingSettingsSchema, customerSchema, invoiceSchema, productSchema, quoteSchema, type DocumentLineInput } from "@/lib/schemas/invoicing";
import { addDays, fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { clearMemoryOutbox, getMemoryOutbox } from "@/server/mail/mailer";
import { addMember, clearRateLimits, createTestCompany, createVerifiedUser, lastMailTo, prisma, resetDatabase } from "./helpers";

const today = todayInParis();
let userId: string;
let access: CompanyAccess;
let otherAccess: CompanyAccess;
let starterAccess: CompanyAccess;
let customerId: string;
let otherCustomerId: string;
let productId: string;

const line = (overrides: Partial<DocumentLineInput> = {}): DocumentLineInput => ({ description: "Prestation de conseil", quantity: "1", unitPriceExclTax: "1000", discountRate: "0", vatRate: "20", ...overrides });
const invoiceInput = (overrides: Record<string, unknown> = {}) => invoiceSchema.parse({ customerId, issueDate: today, items: [line()], ...overrides });
const quoteInput = (overrides: Record<string, unknown> = {}) => quoteSchema.parse({ customerId, issueDate: today, items: [line()], ...overrides });

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text.replace(/\s+/g, " ");
}

async function refresh(companyId: string, forUser = userId) {
  return authorizeCompany(forUser, companyId, "invoices:read");
}

beforeAll(async () => {
  await resetDatabase();
  const owner = await createVerifiedUser({ email: "facturation@exemple.test", plan: "BUSINESS", firstName: "Lina" });
  userId = owner.id;
  const company = await createTestCompany(userId, "Atelier Facturation", { siren: "552100554", addressLine1: "12 rue des Lumières", postalCode: "69001", city: "Lyon", email: "contact@atelier.test" });
  const other = await createTestCompany(userId, "Autre Atelier");
  access = await refresh(company.id);
  otherAccess = await refresh(other.id);

  const starter = await createVerifiedUser({ email: "starter@exemple.test", plan: "STARTER" });
  const starterCompany = await createTestCompany(starter.id, "Micro Starter", { legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" });
  starterAccess = await authorizeCompany(starter.id, starterCompany.id, "invoices:read");

  customerId = (await createCustomer(access, userId, customerSchema.parse({ name: "Maison Verdier", email: "compta@verdier.test", siren: "732829320", addressLine1: "1 place du Marché", postalCode: "69002", city: "Lyon" }))).id;
  otherCustomerId = (await createCustomer(otherAccess, userId, customerSchema.parse({ name: "Client d'une autre entreprise" }))).id;
  productId = (await createProduct(access, userId, productSchema.parse({ name: "Journée de conseil", unit: "jour", unitPriceExclTax: "650", vatRate: "20" }))).id;
});

beforeEach(async () => {
  await clearRateLimits();
  clearMemoryOutbox();
});

describe("clients et catalogue", () => {
  it("recherche, archive et exporte les clients de l'entreprise uniquement", async () => {
    await createCustomer(access, userId, customerSchema.parse({ name: "Studio Oréade", city: "Nantes" }));
    expect((await listCustomers(access, { q: "verdier" })).items.map((c) => c.name)).toEqual(["Maison Verdier"]);
    expect((await listCustomers(access)).total).toBe(2);
    expect((await listCustomers(otherAccess)).items.map((c) => c.name)).toEqual(["Client d'une autre entreprise"]);

    const studio = (await listCustomers(access, { q: "studio" })).items[0];
    await setCustomerArchived(access, userId, studio.id, true);
    expect((await listCustomers(access)).total).toBe(1);
    expect((await listCustomers(access, { archived: true })).items.map((c) => c.name)).toEqual(["Studio Oréade"]);
    await expect(setCustomerArchived(otherAccess, userId, studio.id, true)).rejects.toMatchObject({ status: 404 });

    const csv = await customersCsv(access);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Maison Verdier;Professionnel");
    expect(csv).not.toContain("autre entreprise");
  });

  it("neutralise les formules dans les exports CSV", async () => {
    const tricky = await createCustomer(access, userId, customerSchema.parse({ name: "=HYPERLINK(1)", contactName: "@admin" }));
    const csv = await customersCsv(access);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("'@admin");
    await setCustomerArchived(access, userId, tricky.id, true);
  });

  it("gère les taux de TVA propres à l'entreprise sans toucher au référentiel commun", async () => {
    const before = await listVatRates(access);
    expect(before.filter((r) => r.isSystem).map((r) => r.rate)).toEqual(["20.00", "10.00", "5.50", "2.10", "0.00"]);
    const custom = await createVatRate(access, userId, { label: "Taux DOM — 8,5 %", rate: "8.5" });
    await expect(createVatRate(access, userId, { label: "Doublon", rate: "20" })).rejects.toMatchObject({ code: "VAT_RATE_EXISTS" });
    expect((await listVatRates(otherAccess)).some((r) => r.rate === "8.50")).toBe(false);
    await expect(deleteVatRate(otherAccess, userId, custom.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteVatRate(access, userId, before.find((r) => r.isSystem)!.id)).rejects.toMatchObject({ status: 404 });
    await deleteVatRate(access, userId, custom.id);
  });

  it("en franchise en base, n'accepte ni taux ni ligne avec TVA", async () => {
    const starterUser = (await prisma.companyUser.findFirstOrThrow({ where: { companyId: starterAccess.company.id } })).userId;
    expect((await listVatRates(starterAccess)).map((r) => r.rate)).toEqual(["0.00"]);
    await expect(createProduct(starterAccess, starterUser, productSchema.parse({ name: "Cours", unitPriceExclTax: "50", vatRate: "20" }))).rejects.toMatchObject({ status: 422 });
    const client = await createCustomer(starterAccess, starterUser, customerSchema.parse({ name: "Particulier", type: "INDIVIDUAL" }));
    await expect(createInvoiceDraft(starterAccess, starterUser, invoiceSchema.parse({ customerId: client.id, issueDate: today, items: [line()] }))).rejects.toMatchObject({ status: 422 });
    const draft = await createInvoiceDraft(starterAccess, starterUser, invoiceSchema.parse({ customerId: client.id, issueDate: today, items: [line({ vatRate: "0" })] }));
    const issued = await issueInvoice(starterAccess, starterUser, draft.id);
    const text = await pdfText(await renderDocumentPdf(await buildInvoiceDocument(starterAccess, issued)));
    expect(text).toContain("TVA non applicable, art. 293 B du CGI");
    expect(text).not.toContain("Indemnité forfaitaire"); // client particulier
  });
});

describe("factures : brouillons", () => {
  it("recalcule les totaux côté serveur et fixe l'échéance par défaut", async () => {
    const draft = await createInvoiceDraft(
      access,
      userId,
      invoiceInput({ items: [line({ productId, quantity: "2", unitPriceExclTax: "650", discountRate: "10" }), line({ unitPriceExclTax: "200", vatRate: "10" })], discountType: "PERCENT", discountValue: "5" }),
    );
    // 2 × 650 − 10 % = 1 170 ; + 200 = 1 370 ; remise 5 % = 68,50 → HT 1 301,50
    // TVA : (1 170 − 58,50) × 20 % = 222,30 ; (200 − 10) × 10 % = 19,00
    expect(serializeInvoice(draft)).toMatchObject({
      status: "DRAFT",
      number: null,
      subtotalExclTax: "1370.00",
      discountAmount: "68.50",
      totalExclTax: "1301.50",
      totalVat: "241.30",
      totalInclTax: "1542.80",
      dueDate: addDays(today, 30),
      vatExigibility: "ENCAISSEMENTS",
    });
    await deleteInvoiceDraft(access, userId, draft.id);
    await expect(getInvoiceDetail(access, draft.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuse un client ou un article d'une autre entreprise", async () => {
    await expect(createInvoiceDraft(access, userId, invoiceInput({ customerId: otherCustomerId }))).rejects.toMatchObject({ status: 422 });
    const foreignProduct = await createProduct(otherAccess, userId, productSchema.parse({ name: "Article étranger", unitPriceExclTax: "1", vatRate: "20" }));
    await expect(createInvoiceDraft(access, userId, invoiceInput({ items: [line({ productId: foreignProduct.id })] }))).rejects.toMatchObject({ status: 422 });
    const draft = await createInvoiceDraft(access, userId, invoiceInput());
    await expect(getInvoiceDetail(otherAccess, draft.id)).rejects.toMatchObject({ status: 404 });
    await expect(issueInvoice(otherAccess, userId, draft.id)).rejects.toMatchObject({ status: 404 });
    await deleteInvoiceDraft(access, userId, draft.id);
  });
});

describe("factures : émission et numérotation", () => {
  it("attribue un numéro, fige les parties et verrouille la facture", async () => {
    const draft = await createInvoiceDraft(access, userId, invoiceInput());
    const issued = await issueInvoice(access, userId, draft.id);
    const year = today.slice(0, 4);
    expect(issued.number).toBe(`F-${year}-0001`);
    expect(issued.status).toBe("ISSUED");
    expect(issued.partiesSnapshot).toMatchObject({ seller: { name: "Atelier Facturation", siren: "552100554" }, buyer: { name: "Maison Verdier", siren: "732829320" } });

    await expect(updateInvoiceDraft(access, userId, issued.id, invoiceInput({ items: [line({ unitPriceExclTax: "1" })] }))).rejects.toMatchObject({ code: "INVOICE_LOCKED" });
    await expect(deleteInvoiceDraft(access, userId, issued.id)).rejects.toMatchObject({ code: "INVOICE_LOCKED" });
    await expect(issueInvoice(access, userId, issued.id)).rejects.toMatchObject({ code: "ALREADY_ISSUED" });

    // Une modification ultérieure de la fiche client ne change pas la facture émise.
    await prisma.customer.update({ where: { id: customerId }, data: { name: "Maison Verdier (renommée)" } });
    const document = await buildInvoiceDocument(access, await getInvoiceDetail(access, issued.id));
    expect(document.buyer.name).toBe("Maison Verdier");
    await prisma.customer.update({ where: { id: customerId }, data: { name: "Maison Verdier" } });

    const history = await getInvoiceHistory(access, issued.id);
    expect(history.map((h) => h.action)).toEqual(["invoice.create", "invoice.issue"]);
    expect(history[1].actor).toBe("Lina Martin");
  });

  it("numérote sans trou ni doublon, même en émissions simultanées", async () => {
    const drafts = await Promise.all(Array.from({ length: 12 }, () => createInvoiceDraft(access, userId, invoiceInput())));
    const issued = await Promise.all(drafts.map((draft) => issueInvoice(access, userId, draft.id)));
    const ranks = issued.map((invoice) => Number(invoice.number!.slice(-4))).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 12 }, (_, i) => i + 2)); // 0002 à 0013, après la 0001
    expect(new Set(issued.map((i) => i.number)).size).toBe(12);
  });

  it("rend le numéro si l'émission échoue : aucun trou dans la séquence", async () => {
    const future = await createInvoiceDraft(access, userId, invoiceInput({ issueDate: addDays(today, 3), dueDate: addDays(today, 30) }));
    await expect(issueInvoice(access, userId, future.id)).rejects.toMatchObject({ code: "ISSUE_DATE_IN_FUTURE" });
    const next = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id);
    expect(next.number).toBe(`F-${today.slice(0, 4)}-0014`);
    await deleteInvoiceDraft(access, userId, future.id);
  });

  it("respecte la chronologie : pas de facture antidatée après une facture plus récente", async () => {
    const antedated = await createInvoiceDraft(access, userId, invoiceInput({ issueDate: addDays(today, -5), dueDate: addDays(today, 25) }));
    await expect(issueInvoice(access, userId, antedated.id)).rejects.toMatchObject({ code: "CHRONOLOGY_VIOLATION" });
    await deleteInvoiceDraft(access, userId, antedated.id);
  });

  it("tient une séquence distincte par entreprise", async () => {
    const otherCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomerId } });
    const draft = await createInvoiceDraft(otherAccess, userId, invoiceSchema.parse({ customerId: otherCustomer.id, issueDate: today, items: [line()] }));
    expect((await issueInvoice(otherAccess, userId, draft.id)).number).toBe(`F-${today.slice(0, 4)}-0001`);
  });
});

describe("règlements", () => {
  it("suit les règlements partiels puis le solde, et refuse tout dépassement", async () => {
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id); // 1 200 TTC
    await expect(recordPayment(access, userId, invoice.id, { amount: "1200.01", paidAt: today, method: "TRANSFER" })).rejects.toMatchObject({ status: 422 });
    await expect(recordPayment(access, userId, invoice.id, { amount: "100", paidAt: addDays(today, 1), method: "TRANSFER" })).rejects.toMatchObject({ status: 422 });

    const partial = serializeInvoice(await recordPayment(access, userId, invoice.id, { amount: "500", paidAt: today, method: "TRANSFER", reference: "VIR 123" }));
    expect(partial).toMatchObject({ status: "PARTIALLY_PAID", amountPaid: "500.00", remaining: "700.00" });

    const paid = serializeInvoice(await recordPayment(access, userId, invoice.id, { amount: "700", paidAt: today, method: "CHECK" }));
    expect(paid).toMatchObject({ status: "PAID", remaining: "0.00" });
    await expect(recordPayment(access, userId, invoice.id, { amount: "1", paidAt: today, method: "CASH" })).rejects.toMatchObject({ status: 422 });

    const reverted = serializeInvoice(await deletePayment(access, userId, invoice.id, paid.payments[1].id));
    expect(reverted).toMatchObject({ status: "PARTIALLY_PAID", amountPaid: "500.00", remaining: "700.00" });
    await expect(deletePayment(otherAccess, userId, invoice.id, paid.payments[0].id)).rejects.toMatchObject({ status: 404 });
  });

  it("ne dépasse jamais le reste dû, même avec des règlements simultanés", async () => {
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id); // 1 200 TTC
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => recordPayment(access, userId, invoice.id, { amount: "400", paidAt: today, method: "TRANSFER" })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    expect(serializeInvoice(await getInvoiceDetail(access, invoice.id))).toMatchObject({ status: "PAID", amountPaid: "1200.00" });
  });

  it("refuse le règlement d'un brouillon", async () => {
    const draft = await createInvoiceDraft(access, userId, invoiceInput());
    await expect(recordPayment(access, userId, draft.id, { amount: "10", paidAt: today, method: "CASH" })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    await deleteInvoiceDraft(access, userId, draft.id);
  });
});

describe("avoirs", () => {
  it("corrige une facture émise par un avoir numéroté dans sa propre séquence", async () => {
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id); // 1 200 TTC
    const partialDraft = await createCreditNote(access, userId, invoice.id, { reason: "Remise commerciale", items: [line({ description: "Remise accordée", unitPriceExclTax: "250" })] });
    expect(partialDraft).toMatchObject({ type: "CREDIT_NOTE", status: "DRAFT", originalInvoiceId: invoice.id });
    await expect(createCreditNote(access, userId, invoice.id, { reason: "Deuxième avoir" })).rejects.toMatchObject({ code: "CREDIT_NOTE_PENDING" });
    await expect(recordPayment(access, userId, partialDraft.id, { amount: "1", paidAt: today, method: "CASH" })).rejects.toMatchObject({ code: "NOT_PAYABLE" });

    const creditNote = await issueInvoice(access, userId, partialDraft.id);
    expect(creditNote.number).toBe(`A-${today.slice(0, 4)}-0001`);
    const afterPartial = serializeInvoice(await getInvoiceDetail(access, invoice.id));
    expect(afterPartial).toMatchObject({ status: "ISSUED", creditedAmount: "300.00", remaining: "900.00" });
    expect(afterPartial.creditNotes).toHaveLength(1);

    // Un avoir ne peut pas dépasser le montant de la facture.
    await expect(createCreditNote(access, userId, invoice.id, { reason: "Trop", items: [line({ unitPriceExclTax: "900" })] })).rejects.toMatchObject({ code: "CREDIT_EXCEEDS_INVOICE" });

    // Solde par un second avoir : la facture est soldée sans règlement.
    const rest = await createCreditNote(access, userId, invoice.id, { reason: "Annulation du solde", items: [line({ unitPriceExclTax: "750" })] });
    expect((await issueInvoice(access, userId, rest.id)).number).toBe(`A-${today.slice(0, 4)}-0002`);
    expect(serializeInvoice(await getInvoiceDetail(access, invoice.id))).toMatchObject({ status: "PAID", creditedAmount: "1200.00", remaining: "0.00" });

    const text = await pdfText(await renderDocumentPdf(await buildInvoiceDocument(access, creditNote)));
    expect(text).toContain("AVOIR");
    expect(text).toContain(`Avoir relatif à la facture ${invoice.number}`);
  });

  it("n'accepte un avoir que sur une facture émise", async () => {
    const draft = await createInvoiceDraft(access, userId, invoiceInput());
    await expect(createCreditNote(access, userId, draft.id, { reason: "Erreur" })).rejects.toMatchObject({ code: "INVALID_CREDIT_NOTE" });
    await deleteInvoiceDraft(access, userId, draft.id);
  });

  it("déduit le chiffre d'affaires et le reste à encaisser dans le tableau de bord", async () => {
    const before = await getDashboard(access.company, { preset: "7d" });
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id); // 1 000 HT, 1 200 TTC
    const credit = await issueInvoice(access, userId, (await createCreditNote(access, userId, invoice.id, { reason: "Geste", items: [line({ unitPriceExclTax: "100" })] })).id);
    expect(credit.type).toBe("CREDIT_NOTE");
    const after = await getDashboard(access.company, { preset: "7d" });
    expect(Number(after.kpis.periodRevenue) - Number(before.kpis.periodRevenue)).toBe(900); // 1 000 − 100
    expect(Number(after.kpis.unpaid.amount) - Number(before.kpis.unpaid.amount)).toBe(1080); // 1 200 − 120
  });
});

describe("devis", () => {
  it("numérote à la création, se modifie en brouillon et suit son cycle de vie", async () => {
    const quote = await createQuote(access, userId, quoteInput({ subject: "Refonte du site" }));
    expect(quote.number).toBe(`D-${today.slice(0, 4)}-0001`);
    expect(toIsoDate(quote.validUntil!)).toBe(addDays(today, 30));

    const updated = await updateQuote(access, userId, quote.id, quoteInput({ subject: "Refonte du site", items: [line({ unitPriceExclTax: "2000" })] }));
    expect(updated.totalInclTax.toFixed(2)).toBe("2400.00");

    await setQuoteStatus(access, userId, quote.id, "SENT");
    await expect(updateQuote(access, userId, quote.id, quoteInput())).rejects.toMatchObject({ code: "QUOTE_LOCKED" });
    await expect(setQuoteStatus(otherAccess, userId, quote.id, "ACCEPTED")).rejects.toMatchObject({ status: 404 });
    await setQuoteStatus(access, userId, quote.id, "ACCEPTED");
    await expect(setQuoteStatus(access, userId, quote.id, "REJECTED")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    // Un devis envoyé dont la validité est dépassée apparaît comme expiré.
    const expired = await createQuote(access, userId, quoteInput({ issueDate: addDays(today, -40), validUntil: addDays(today, -10) }));
    await setQuoteStatus(access, userId, expired.id, "SENT");
    expect((await listQuotes(access, { filter: "EXPIRED" })).items.map((q) => q.id)).toEqual([expired.id]);
    expect((await listQuotes(access, { filter: "SENT" })).items).toHaveLength(0);
  });

  it("se transforme en facture d'acompte puis en facture finale, acompte déduit", async () => {
    const quote = await createQuote(
      access,
      userId,
      quoteInput({ subject: "Site vitrine", items: [line({ unitPriceExclTax: "1000" }), line({ description: "Hébergement", unitPriceExclTax: "500", vatRate: "10" })], discountType: "PERCENT", discountValue: "10" }),
    );
    // Devis : bases nettes 900 (20 %) et 450 (10 %) → HT 1 350, TVA 180 + 45, TTC 1 575
    expect(quote.totalInclTax.toFixed(2)).toBe("1575.00");
    await expect(convertQuote(access, userId, quote.id, { mode: "invoice" })).rejects.toMatchObject({ code: "QUOTE_NOT_ACCEPTED" });
    await setQuoteStatus(access, userId, quote.id, "SENT");

    const depositDraft = await convertQuote(access, userId, quote.id, { mode: "deposit", percent: "30" });
    // 30 % : 270 (20 %) + 135 (10 %) → HT 405, TVA 54 + 13,50, TTC 472,50
    expect(serializeInvoice(depositDraft)).toMatchObject({ type: "DEPOSIT", totalExclTax: "405.00", totalVat: "67.50", totalInclTax: "472.50", vatExigibility: "ENCAISSEMENTS" });
    expect((await getQuoteDetail(access, quote.id)).status).toBe("ACCEPTED");
    await expect(convertQuote(access, userId, quote.id, { mode: "invoice" })).rejects.toMatchObject({ code: "DEPOSIT_DRAFT_PENDING" });
    await expect(convertQuote(access, userId, quote.id, { mode: "deposit", percent: "80" })).rejects.toMatchObject({ code: "DEPOSIT_EXCEEDS_QUOTE" });
    const deposit = await issueInvoice(access, userId, depositDraft.id);

    const finalDraft = await convertQuote(access, userId, quote.id, { mode: "invoice" });
    // Facture finale : 1 350 − 405 = 945 HT ; TVA (900 − 270) × 20 % + (450 − 135) × 10 % = 126 + 31,50 ; TTC 1 102,50
    const final = serializeInvoice(finalDraft);
    expect(final).toMatchObject({ type: "INVOICE", totalExclTax: "945.00", totalVat: "157.50", totalInclTax: "1102.50" });
    expect(final.items.filter((item) => item.unitPriceExclTax.startsWith("-")).map((item) => item.description)).toEqual([
      expect.stringContaining(deposit.number!),
      expect.stringContaining(deposit.number!),
    ]);
    // Acompte + facture finale = montant du devis, au centime.
    expect(Number(deposit.totalInclTax) + Number(final.totalInclTax)).toBe(1575);
    expect((await getQuoteDetail(access, quote.id)).status).toBe("INVOICED");
    await expect(convertQuote(access, userId, quote.id, { mode: "invoice" })).rejects.toMatchObject({ code: "QUOTE_NOT_ACCEPTED" });

    // Supprimer le brouillon de facture finale rend le devis de nouveau facturable.
    await deleteInvoiceDraft(access, userId, finalDraft.id);
    expect((await getQuoteDetail(access, quote.id)).status).toBe("ACCEPTED");
  });

  it("réserve les factures d'acompte aux formules qui les incluent", async () => {
    const starterUser = (await prisma.companyUser.findFirstOrThrow({ where: { companyId: starterAccess.company.id } })).userId;
    const client = await tenantDb(starterAccess.company.id).customer.findFirstOrThrow();
    const quote = await createQuote(starterAccess, starterUser, quoteSchema.parse({ customerId: client.id, issueDate: today, items: [line({ vatRate: "0" })] }));
    await setQuoteStatus(starterAccess, starterUser, quote.id, "SENT");
    await expect(convertQuote(starterAccess, starterUser, quote.id, { mode: "deposit", percent: "30" })).rejects.toMatchObject({ status: 403, code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(convertQuote(starterAccess, starterUser, quote.id, { mode: "invoice" })).resolves.toMatchObject({ type: "INVOICE" });
  });
});

describe("PDF, envoi et relances", () => {
  it("génère un PDF portant les mentions obligatoires", async () => {
    await updateBillingSettings(
      access,
      userId,
      billingSettingsSchema.parse({ invoicePrefix: "F", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30, latePenaltyRate: "12", rcsCity: "Lyon", shareCapital: "10000", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP" }),
    );
    access = await refresh(access.company.id);
    const stored = await prisma.company.findUniqueOrThrow({ where: { id: access.company.id } });
    expect(stored.ibanEncrypted).not.toContain("FR7630006000011234567890189"); // chiffré au repos
    expect((await getBillingSettings(access)).ibanMasked).toBe("FR76 •••• •••• 0189");

    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput({ subject: "Mission de conseil", serviceDate: today }))).id);
    const pdf = await renderDocumentPdf(await buildInvoiceDocument(access, invoice));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await pdfText(pdf);
    for (const expected of [
      "FACTURE",
      `N° ${invoice.number}`,
      "Atelier Facturation",
      "SIREN : 552100554",
      "N° TVA : FR96552100554",
      "Maison Verdier",
      "SIREN : 732829320",
      "Prestation de conseil",
      "Total HT",
      "TVA 20 % sur 1 000,00 €",
      "Total TTC",
      "1 200,00 €",
      "IBAN : FR76 3000 6000 0112 3456 7890 189",
      "Nature de l'opération : prestation de services",
      "pénalités sont exigibles au taux annuel de 12,00 %",
      "Indemnité forfaitaire pour frais de recouvrement",
      "Pas d'escompte pour paiement anticipé",
      "SASU au capital de 10 000 €",
      "RCS Lyon",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toContain("BROUILLON");

    const draftText = await pdfText(await renderDocumentPdf(await buildInvoiceDocument(access, await createInvoiceDraft(access, userId, invoiceInput()))));
    expect(draftText).toContain("BROUILLON");
    expect(draftText).toContain("sans numéro");
  });

  it("envoie la facture avec son PDF en pièce jointe et trace l'envoi", async () => {
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id);
    const sender = { id: userId, email: "facturation@exemple.test", firstName: "Lina", lastName: "Martin" };
    const draft = await createInvoiceDraft(access, userId, invoiceInput());
    await expect(sendInvoiceByEmail(access, sender, draft.id, { to: "x@exemple.test", subject: "Facture", message: "Bonjour" })).rejects.toMatchObject({ code: "INVOICE_NOT_ISSUED" });

    await sendInvoiceByEmail(access, sender, invoice.id, { to: "compta@verdier.test", subject: `Facture ${invoice.number}`, message: "Bonjour,\n\nVoici votre facture.", copyToSelf: true });
    const mail = lastMailTo("compta@verdier.test");
    expect(mail.cc).toBe("facturation@exemple.test");
    expect(mail.replyTo).toBe("contact@atelier.test");
    expect(mail.attachments?.[0]).toMatchObject({ filename: `facture-${invoice.number!.toLowerCase()}.pdf`, contentType: "application/pdf" });
    expect(mail.attachments![0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await getInvoiceDetail(access, invoice.id)).status).toBe("SENT");
    expect((await getInvoiceHistory(access, invoice.id)).at(-1)).toMatchObject({ action: "invoice.sent", detail: "Envoyée par e-mail à compta@verdier.test" });
  });

  it("envoie un devis et le passe à l'état envoyé", async () => {
    const quote = await createQuote(access, userId, quoteInput());
    await sendQuoteByEmail(access, null, quote.id, { to: "compta@verdier.test", subject: "Devis", message: "Bonjour" });
    expect(lastMailTo("compta@verdier.test").attachments?.[0].filename).toBe(`devis-${quote.number.toLowerCase()}.pdf`);
    expect((await getQuoteDetail(access, quote.id)).status).toBe("SENT");
    const text = await pdfText(await renderDocumentPdf(await buildQuoteDocument(access, await getQuoteDetail(access, quote.id))));
    expect(text).toContain("DEVIS");
    expect(text).toContain("Bon pour accord");
  });

  it("relance une facture échue, manuellement puis automatiquement selon les délais", async () => {
    const invoice = await issueInvoice(access, userId, (await createInvoiceDraft(access, userId, invoiceInput())).id);
    await expect(sendReminder(access, null, invoice.id)).rejects.toMatchObject({ code: "NOT_OVERDUE" });

    // Échéance dépassée de 8 jours.
    await prisma.invoice.update({ where: { id: invoice.id }, data: { dueDate: fromIsoDate(addDays(today, -8)) } });
    const manual = await sendReminder(access, null, invoice.id);
    expect(manual).toEqual({ to: "compta@verdier.test", rank: 1 });
    expect(lastMailTo("compta@verdier.test").subject).toContain(`Rappel — facture ${invoice.number}`);

    // Automatisation désactivée : rien ne part.
    clearMemoryOutbox();
    await prisma.invoice.update({ where: { id: invoice.id }, data: { lastReminderAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await runAutomaticReminders()).sent).toBe(0);

    await updateBillingSettings(access, userId, {
      ...billingSettingsSchema.parse({ invoicePrefix: "F", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30, remindersEnabled: true, reminderDelaysDays: [7, 15, 30] }),
      keepIban: true,
    });
    // Deuxième relance prévue à 15 jours : à 8 jours de retard, elle attend.
    const waiting = await runAutomaticReminders();
    expect(getMemoryOutbox().filter((m) => m.subject.includes(invoice.number!))).toHaveLength(0);
    expect(waiting.errors).toBe(0);

    await prisma.invoice.update({ where: { id: invoice.id }, data: { dueDate: fromIsoDate(addDays(today, -16)) } });
    await runAutomaticReminders();
    const second = getMemoryOutbox().filter((m) => m.subject.includes(invoice.number!));
    expect(second).toHaveLength(1);
    expect(second[0].subject).toContain("Relance n° 2");
    // Pas de seconde relance le même jour.
    await runAutomaticReminders();
    expect(getMemoryOutbox().filter((m) => m.subject.includes(invoice.number!))).toHaveLength(1);

    // Une facture soldée n'est plus relancée.
    await recordPayment(access, userId, invoice.id, { amount: "1200", paidAt: today, method: "TRANSFER" });
    await expect(sendReminder(access, null, invoice.id)).rejects.toMatchObject({ code: "NOT_OVERDUE" });
  });
});

describe("factures récurrentes", () => {
  it("génère, émet et envoie les factures arrivées à échéance", async () => {
    expect(nextOccurrence("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(nextOccurrence("2026-11-13", "QUARTERLY")).toBe("2027-02-13");

    const recurring = await createRecurringInvoice(access, userId, {
      customerId,
      label: "Maintenance mensuelle",
      frequency: "MONTHLY",
      nextRunDate: today,
      autoIssue: true,
      autoSend: true,
      operationCategory: "SERVICES",
      items: [{ description: "Maintenance", quantity: "1", unitPriceExclTax: "320", discountRate: "0", vatRate: "20" }],
    });
    await expect(createRecurringInvoice(access, userId, { customerId, label: "Passé", frequency: "MONTHLY", nextRunDate: addDays(today, -1), autoIssue: false, autoSend: false, operationCategory: "SERVICES", items: [line()] })).rejects.toMatchObject({ status: 422 });

    const run = await runRecurringInvoices();
    expect(run).toMatchObject({ generated: 1, issued: 1, sent: 1, errors: 0 });
    const [view] = await listRecurringInvoices(access);
    expect(view).toMatchObject({ id: recurring.id, invoiceCount: 1, totalInclTax: "384.00", status: "ACTIVE" });
    expect(view.nextRunDate > today).toBe(true);

    const generated = (await listInvoices(access, { q: "Maintenance mensuelle" })).items[0];
    expect(generated).toMatchObject({ status: "SENT", totalInclTax: "384.00" });
    expect(generated.number).toMatch(/^F-\d{4}-\d{4}$/);
    expect(lastMailTo("compta@verdier.test").attachments).toHaveLength(1);

    // Le lendemain, rien de nouveau ; en pause, rien non plus.
    expect((await runRecurringInvoices()).generated).toBe(0);
    await setRecurringStatus(access, userId, recurring.id, "PAUSED");
    await prisma.recurringInvoice.update({ where: { id: recurring.id }, data: { nextRunDate: fromIsoDate(addDays(today, -3)) } });
    expect((await runRecurringInvoices()).generated).toBe(0);
    await setRecurringStatus(access, userId, recurring.id, "ACTIVE");
    expect((await listRecurringInvoices(access))[0].nextRunDate >= today).toBe(true); // pas de rattrapage après une pause
  });

  it("sont réservées aux formules qui les incluent", async () => {
    const starterUser = (await prisma.companyUser.findFirstOrThrow({ where: { companyId: starterAccess.company.id } })).userId;
    const client = await tenantDb(starterAccess.company.id).customer.findFirstOrThrow();
    await expect(
      createRecurringInvoice(starterAccess, starterUser, { customerId: client.id, label: "Abonnement", frequency: "MONTHLY", nextRunDate: today, autoIssue: false, autoSend: false, operationCategory: "SERVICES", items: [line({ vatRate: "0" })] }),
    ).rejects.toMatchObject({ status: 403, code: "PLAN_FEATURE_UNAVAILABLE" });
  });
});

describe("paramètres, logo, permissions et export", () => {
  it("verrouille les préfixes après la première émission", async () => {
    const settings = billingSettingsSchema.parse({ invoicePrefix: "FA", quotePrefix: "DV", creditNotePrefix: "A", defaultPaymentTermDays: 45, quoteValidityDays: 60 });
    await expect(updateBillingSettings(access, userId, { ...settings, keepIban: true })).rejects.toMatchObject({ code: "PREFIX_LOCKED" });
    const allowed = await updateBillingSettings(access, userId, { ...settings, invoicePrefix: "F", keepIban: true });
    expect(allowed).toMatchObject({ quotePrefix: "DV", defaultPaymentTermDays: 45 });
    expect(allowed.ibanEncrypted).not.toBeNull(); // conservé
    expect((await getBillingSettings(await refresh(access.company.id))).prefixesLocked).toBe(true);
  });

  it("n'accepte comme logo qu'une véritable image PNG ou JPEG", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await expect(saveLogo(access, userId, { mimeType: "image/png", dataBase64: Buffer.from("<script>alert(1)</script>").toString("base64") })).rejects.toMatchObject({ status: 422 });
    await expect(saveLogo(access, userId, { mimeType: "image/jpeg", dataBase64: png.toString("base64") })).rejects.toMatchObject({ status: 422 });
    await saveLogo(access, userId, { mimeType: "image/png", dataBase64: png.toString("base64") });
    expect((await getLogo(access.company.id))?.mimeType).toBe("image/png");
    expect(await getLogo(otherAccess.company.id)).toBeNull();
    // Le PDF se génère avec le logo.
    const invoice = (await listInvoices(access, { filter: "paid" })).items[0];
    const pdf = await renderDocumentPdf(await buildInvoiceDocument(await refresh(access.company.id), await getInvoiceDetail(access, invoice.id)));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("applique les permissions par rôle", async () => {
    const reader = await createVerifiedUser({ email: "lecteur@exemple.test" });
    const accountant = await createVerifiedUser({ email: "expert@exemple.test" });
    const collaborator = await createVerifiedUser({ email: "collab@exemple.test" });
    await addMember(access.company.id, reader.id, "READ_ONLY");
    await addMember(access.company.id, accountant.id, "EXTERNAL_ACCOUNTANT");
    await addMember(access.company.id, collaborator.id, "COLLABORATOR");

    await expect(authorizeCompany(reader.id, access.company.id, "invoices:read")).resolves.toBeDefined();
    for (const permission of ["invoices:write", "invoices:issue", "payments:write", "customers:write", "quotes:write"] as const) {
      await expect(authorizeCompany(reader.id, access.company.id, permission), `lecture seule ✗ ${permission}`).rejects.toMatchObject({ status: 403 });
      await expect(authorizeCompany(collaborator.id, access.company.id, permission), `collaborateur → ${permission}`).resolves.toBeDefined();
    }
    await expect(authorizeCompany(accountant.id, access.company.id, "invoices:issue")).rejects.toMatchObject({ status: 403 });
    await expect(authorizeCompany(collaborator.id, access.company.id, "company:update")).rejects.toMatchObject({ status: 403 });
  });

  it("filtre les factures et les exporte en CSV", async () => {
    expect((await listInvoices(access, { filter: "credit_note" })).items.every((i) => i.type === "CREDIT_NOTE")).toBe(true);
    expect((await listInvoices(access, { filter: "draft" })).items.every((i) => i.status === "DRAFT" && i.number === null)).toBe(true);
    const unpaid = await listInvoices(access, { filter: "unpaid", pageSize: 100 });
    expect(unpaid.items.every((i) => Number(i.remaining) > 0)).toBe(true);
    expect((await listInvoices(otherAccess)).total).toBe(1);

    const csv = await invoicesCsv(access);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toContain("Numéro;Type;Statut;Date d'émission");
    expect(rows.slice(1).every((row) => /^[FA]-\d{4}-\d{4};/.test(row))).toBe(true); // aucun brouillon
    expect(csv).toContain(";1000,00;200,00;1200,00;");
    expect((await invoicesCsv(otherAccess)).trim().split("\r\n")).toHaveLength(2);
  });
});
