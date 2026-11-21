import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/server/http/errors";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { createCustomer } from "@/server/modules/customers/service";
import { createInvoiceDraft, issueInvoice, recordPayment } from "@/server/modules/invoicing/invoices";
import { updateBillingSettings } from "@/server/modules/invoicing/settings";
import { buildFacturX } from "@/server/modules/invoicing/facturx";
import { listCategories } from "@/server/modules/bank/categories";
import { getDecrypted } from "@/server/storage";
import { summarize } from "@/server/modules/einvoicing/lifecycle";
import { parseIncomingInvoice } from "@/server/modules/einvoicing/parse";
import { setEInvoicePlatformForTests, type EInvoicePlatform, type IncomingInvoiceFile, type LifecycleUpdate } from "@/server/modules/einvoicing/platform";
import {
  createPurchaseFromIncoming,
  declareCollected,
  einvoicingAvailable,
  getInvoiceEInvoicing,
  handleEInvoiceWebhook,
  incomingXml,
  listIncomingInvoices,
  processEInvoiceQueue,
  respondToIncoming,
  setEInvoicingReception,
  submitInvoice,
  syncEInvoicing,
} from "@/server/modules/einvoicing/service";
import { billingSettingsSchema, customerSchema, invoiceSchema } from "@/lib/schemas/invoicing";
import { todayInParis } from "@/lib/dates";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

/** Plateforme agréée simulée : dépôts idempotents, statuts et factures reçues en mémoire, webhooks signés. */
class FakePlatform implements EInvoicePlatform {
  readonly key = "simulee";
  readonly label = "Plateforme simulée";
  submissions: Array<{ idempotencyKey: string; senderSiren: string; recipientSiren: string; content: Buffer; mimeType: string; platformRef: string }> = [];
  updates: LifecycleUpdate[] = [];
  incoming: IncomingInvoiceFile[] = [];
  sent: Array<{ platformRef: string; direction: string; code: number; reason?: string }> = [];
  failNext = 0;
  private counter = 0;

  async submit(input: Parameters<EInvoicePlatform["submit"]>[0]) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("plateforme indisponible (503)");
    }
    const previous = this.submissions.find((s) => s.idempotencyKey === input.idempotencyKey);
    if (previous) return { platformRef: previous.platformRef };
    const platformRef = `DEP-${++this.counter}`;
    this.submissions.push({ ...input, platformRef });
    return { platformRef };
  }
  async listLifecycleUpdates(since: Date | null) {
    return this.updates.filter((u) => !since || u.occurredAt >= since);
  }
  async listIncoming(since: Date | null) {
    return this.incoming.filter((f) => !since || f.receivedAt >= since);
  }
  async sendStatus(input: { platformRef: string; direction: string; code: number; reason?: string }) {
    this.sent.push(input);
  }
  async verifyWebhook(rawBody: string, headers: Headers) {
    const expected = createHmac("sha256", "secret-plateforme").update(rawBody).digest("hex");
    if (headers.get("x-signature") !== expected) return null;
    const body = JSON.parse(rawBody) as { updates: Array<Omit<LifecycleUpdate, "occurredAt"> & { occurredAt: string }> };
    return { lifecycle: body.updates.map((u) => ({ ...u, occurredAt: new Date(u.occurredAt) })), incomingAvailable: false };
  }
}

const platform = new FakePlatform();
const today = todayInParis();
let userId: string;
let seller: CompanyAccess;
let buyer: CompanyAccess;
let customerId: string;

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

async function issue(amount = "100", target = customerId) {
  const draft = await createInvoiceDraft(seller, userId, invoiceSchema.parse({ customerId: target, issueDate: today, serviceDate: today, items: [{ description: "Accompagnement", quantity: "1", unitPriceExclTax: amount, discountRate: "0", vatRate: "20" }] }));
  return issueInvoice(seller, userId, draft.id);
}

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  await resetDatabase();
  const user = await createVerifiedUser({ email: "einvoice@exemple.test", plan: "BUSINESS" });
  userId = user.id;
  const sellerCompany = await createTestCompany(userId, "Atelier Émetteur SAS", { siren: "552100554", addressLine1: "12 rue des Lilas", postalCode: "69003", city: "Lyon" });
  seller = await authorizeCompany(userId, sellerCompany.id, "company:read");
  await updateBillingSettings(seller, userId, billingSettingsSchema.parse({ invoicePrefix: "F", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30, rcsCity: "Lyon", shareCapital: "10000", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP" }));
  seller = await authorizeCompany(userId, sellerCompany.id, "company:read");
  const buyerCompany = await createTestCompany(userId, "Maison Verdier SARL", { siren: "732829320", addressLine1: "4 place Bellecour", postalCode: "69002", city: "Lyon" });
  buyer = await authorizeCompany(userId, buyerCompany.id, "company:read");
  customerId = (await createCustomer(seller, userId, customerSchema.parse({ name: "Maison Verdier SARL", siren: "732829320", email: "compta@verdier.test", addressLine1: "4 place Bellecour", postalCode: "69002", city: "Lyon" }))).id;
});

afterAll(() => setEInvoicePlatformForTests(undefined));

describe("sans plateforme raccordée", () => {
  it("le module est absent : rien n'est affiché, toute action est refusée", async () => {
    setEInvoicePlatformForTests(null);
    const invoice = await issue();
    expect(einvoicingAvailable()).toBe(false);
    expect(await getInvoiceEInvoicing(seller, invoice.id)).toBeNull();
    await expectAppError(submitInvoice(seller, userId, invoice.id), "EINVOICING_UNAVAILABLE");
    expect(await processEInvoiceQueue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(await syncEInvoicing()).toEqual({ statuses: 0, received: 0, ignored: 0 });
    setEInvoicePlatformForTests(platform);
  });
});

describe("cycle de vie", () => {
  it("résume la situation par le statut le plus récent", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 1, 10, m));
    expect(summarize([{ code: 200, occurredAt: t(0) }, { code: 205, occurredAt: t(5) }])).toBe("ACCEPTED");
    expect(summarize([{ code: 207, occurredAt: t(9) }, { code: 205, occurredAt: t(5) }])).toBe("DISPUTED");
    expect(summarize([{ code: 999, occurredAt: t(9) }])).toBeNull();
  });
});

describe("émission", () => {
  it("n'accepte que les factures émises, Factur-X, adressées à une entreprise française identifiée", async () => {
    const individual = (await createCustomer(seller, userId, customerSchema.parse({ type: "INDIVIDUAL", name: "Jeanne Martin", email: "jeanne@exemple.test", addressLine1: "1 rue Neuve", postalCode: "75001", city: "Paris" }))).id;
    const invoice = await issue("80", individual);
    const view = await getInvoiceEInvoicing(seller, invoice.id);
    expect(view?.canSubmit).toBe(false);
    expect(view?.problems.join(" ")).toContain("e-reporting");
    await expectAppError(submitInvoice(seller, userId, invoice.id), "EINVOICE_NOT_ELIGIBLE");
  });

  it("dépose l'original archivé, une seule fois, et suit les statuts de la plateforme et du client", async () => {
    const invoice = await issue("1000");
    const view = await submitInvoice(seller, userId, invoice.id);
    expect(view).toMatchObject({ status: "DEPOSITED", canSubmit: false });
    expect(view.events.map((e) => e.label)).toEqual(["Déposée"]);

    // Le fichier transmis est l'original archivé (Factur-X), identique octet pour octet.
    const submission = platform.submissions.at(-1)!;
    const archived = await prisma.document.findFirstOrThrow({ where: { id: (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).pdfDocumentId! } });
    expect(submission.content.equals((await getDecrypted(archived.storageKey))!)).toBe(true);
    expect(submission).toMatchObject({ senderSiren: "552100554", recipientSiren: "732829320", mimeType: "application/pdf" });
    expect(submission.content.toString("latin1")).toContain("factur-x.xml");
    await expectAppError(submitInvoice(seller, userId, invoice.id), "EINVOICE_ALREADY_SUBMITTED");

    platform.updates.push(
      { platformRef: submission.platformRef, direction: "OUTGOING", code: 203, occurredAt: new Date(Date.now() + 1000), source: "PLATFORM" },
      { platformRef: submission.platformRef, direction: "OUTGOING", code: 205, occurredAt: new Date(Date.now() + 2000), source: "BUYER" },
      { platformRef: submission.platformRef, direction: "OUTGOING", code: 777, occurredAt: new Date(Date.now() + 3000), source: "PLATFORM" },
      { platformRef: "INCONNU", direction: "OUTGOING", code: 210, occurredAt: new Date(Date.now() + 3000), source: "BUYER" },
    );
    expect(await syncEInvoicing()).toMatchObject({ statuses: 2 });
    // Rejouer la synchronisation n'enregistre rien deux fois.
    expect(await syncEInvoicing()).toMatchObject({ statuses: 0 });
    const after = (await getInvoiceEInvoicing(seller, invoice.id))!;
    expect(after.status).toBe("ACCEPTED");
    expect(after.events.map((e) => e.label)).toEqual(["Déposée", "Mise à disposition", "Approuvée"]);

    // Encaissement : uniquement sur déclaration, une fois la facture réglée.
    expect(after.canDeclareCollected).toBe(false);
    await expectAppError(declareCollected(seller, userId, invoice.id), "EINVOICE_NOT_COLLECTABLE");
    await recordPayment(seller, userId, invoice.id, { amount: "1200.00", paidAt: today, method: "TRANSFER" });
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await getInvoiceEInvoicing(seller, invoice.id))!.canDeclareCollected).toBe(true);
    const collected = await declareCollected(seller, userId, invoice.id);
    expect(collected.status).toBe("PAID");
    expect(platform.sent.at(-1)).toMatchObject({ platformRef: submission.platformRef, direction: "OUTGOING", code: 212 });
    expect(collected.canDeclareCollected).toBe(false);
  });

  it("un rejet de la plateforme permet un nouveau dépôt", async () => {
    const invoice = await issue("50");
    await submitInvoice(seller, userId, invoice.id);
    const ref = platform.submissions.at(-1)!.platformRef;
    platform.updates.push({ platformRef: ref, direction: "OUTGOING", code: 213, reason: "Destinataire inconnu de l'annuaire", occurredAt: at(5), source: "PLATFORM" });
    await syncEInvoicing();
    const view = (await getInvoiceEInvoicing(seller, invoice.id))!;
    expect(view).toMatchObject({ status: "REJECTED", canSubmit: true });
    expect(view.events.at(-1)).toMatchObject({ label: "Rejetée", reason: "Destinataire inconnu de l'annuaire" });
    expect((await submitInvoice(seller, userId, invoice.id)).status).toBe("DEPOSITED");
  });

  it("retente un dépôt en échec, puis l'abandonne après six tentatives", async () => {
    const invoice = await issue("60");
    platform.failNext = 1;
    const first = await submitInvoice(seller, userId, invoice.id);
    expect(first.status).toBe("PENDING");
    expect(first.transmissions[0]).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "plateforme indisponible (503)" });
    // Pas avant l'échéance de la nouvelle tentative…
    expect(await processEInvoiceQueue()).toMatchObject({ sent: 0 });
    // … puis déposée.
    expect(await processEInvoiceQueue(at(2))).toMatchObject({ sent: 1 });
    expect((await getInvoiceEInvoicing(seller, invoice.id))!.status).toBe("DEPOSITED");

    const doomed = await issue("70");
    platform.failNext = 100;
    await submitInvoice(seller, userId, doomed.id);
    for (let i = 1; i <= 6; i++) await processEInvoiceQueue(at(i * 24 * 60));
    platform.failNext = 0;
    const view = (await getInvoiceEInvoicing(seller, doomed.id))!;
    expect(view.transmissions[0]).toMatchObject({ status: "FAILED", attempts: 6 });
    expect(view).toMatchObject({ status: "NOT_APPLICABLE", canSubmit: true });
    expect(await prisma.auditLog.count({ where: { entityId: doomed.id, action: "einvoice.failed" } })).toBe(1);
  });

  it("reprend un dépôt interrompu sans le dupliquer (clé d'idempotence)", async () => {
    const invoice = await issue("90");
    platform.failNext = 1;
    await submitInvoice(seller, userId, invoice.id);
    const transmission = await prisma.eInvoiceTransmission.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    // Processus interrompu pendant l'envoi.
    await prisma.$executeRaw`UPDATE einvoice_transmissions SET status = 'SENDING', updatedAt = ${new Date(Date.now() - 20 * 60_000)} WHERE id = ${transmission.id}`;
    const count = platform.submissions.length;
    expect(await processEInvoiceQueue(at(10))).toMatchObject({ sent: 1 });
    expect(platform.submissions.filter((s) => s.idempotencyKey === transmission.id)).toHaveLength(1);
    expect(platform.submissions.length).toBe(count + 1);
  });

  it("n'accepte que les webhooks authentiques", async () => {
    const invoice = await issue("40");
    await submitInvoice(seller, userId, invoice.id);
    const ref = platform.submissions.at(-1)!.platformRef;
    const body = JSON.stringify({ updates: [{ platformRef: ref, direction: "OUTGOING", code: 207, reason: "Quantité contestée", occurredAt: at(30).toISOString(), source: "BUYER" }] });
    expect(await handleEInvoiceWebhook(body, new Headers({ "x-signature": "faux" }))).toBeNull();
    const signature = createHmac("sha256", "secret-plateforme").update(body).digest("hex");
    expect(await handleEInvoiceWebhook(body, new Headers({ "x-signature": signature }))).toMatchObject({ recorded: 1 });
    expect((await getInvoiceEInvoicing(seller, invoice.id))!.status).toBe("DISPUTED");
  });
});

describe("réception", () => {
  let factureXml: string;

  it("la réception s'active par entreprise, pour un SIREN unique", async () => {
    await expectAppError(setEInvoicingReception(seller, userId, true).then(async () => {
      const twin = await createTestCompany(userId, "Atelier Émetteur (doublon)", { siren: "552100554" });
      return setEInvoicingReception(await authorizeCompany(userId, twin.id, "company:read"), userId, true);
    }), "SIREN_ALREADY_RECEIVING");
    const noSiren = await authorizeCompany(userId, (await createTestCompany(userId, "Sans SIREN")).id, "company:read");
    await expectAppError(setEInvoicingReception(noSiren, userId, true), "SIREN_REQUIRED");
    await setEInvoicingReception(buyer, userId, true);
  });

  it("lit les données d'une facture CII (Factur-X) et UBL", async () => {
    const invoice = await issue("250");
    factureXml = buildFacturX(seller.company, invoice).xml;
    expect(parseIncomingInvoice(factureXml, "FACTUR_X")).toMatchObject({ number: invoice.number, sellerName: "Atelier Émetteur SAS", sellerSiren: "552100554", buyerSiren: "732829320", totalExclTax: "250.00", totalVat: "50.00", totalInclTax: "300.00", currency: "EUR", creditNote: false });
    const ubl = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
      <cbc:ID>UBL-42</cbc:ID><cbc:IssueDate>2026-11-02</cbc:IssueDate><cbc:DueDate>2026-12-02</cbc:DueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>FR40303265045</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Fournitures Durand</cbc:RegistrationName><cbc:CompanyID schemeID="0002">303265045</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
      <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Maison Verdier</cbc:RegistrationName><cbc:CompanyID schemeID="0002">732829320</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
      <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">8.40</cbc:TaxAmount></cac:TaxTotal>
      <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">42.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">50.40</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>`;
    expect(parseIncomingInvoice(ubl, "UBL")).toMatchObject({ number: "UBL-42", issueDate: "2026-11-02", dueDate: "2026-12-02", sellerName: "Fournitures Durand", sellerSiren: "303265045", sellerVatNumber: "FR40303265045", totalInclTax: "50.40", totalVat: "8.40" });
    expect(() => parseIncomingInvoice('<!DOCTYPE x [<!ENTITY a "b">]><Invoice/>', "UBL")).toThrow("DTD");
  });

  it("rattache les factures reçues à l'entreprise destinataire, enregistre l'achat ou transmet le refus", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
    platform.incoming.push(
      { platformRef: "REC-1", recipientSiren: "732829320", format: "FACTUR_X", xml: factureXml, pdf, receivedAt: at(1) },
      { platformRef: "REC-2", recipientSiren: "999999999", format: "FACTUR_X", xml: factureXml, receivedAt: at(1) },
      { platformRef: "REC-3", recipientSiren: "732829320", format: "FACTUR_X", xml: "<pas-une-facture/>", receivedAt: at(1) },
      { platformRef: "REC-4", recipientSiren: "732829320", format: "FACTUR_X", xml: factureXml.replace(/<ram:ID>F-[^<]+<\/ram:ID>/, "<ram:ID>F-SECONDE</ram:ID>"), receivedAt: at(2) },
    );
    expect(await syncEInvoicing()).toMatchObject({ received: 2, ignored: 2 });
    expect(await syncEInvoicing()).toMatchObject({ received: 0 });
    const list = await listIncomingInvoices(buyer);
    expect(list).toHaveLength(2);
    expect(await listIncomingInvoices(seller)).toHaveLength(0);
    const first = list.find((i) => i.documentId)!;
    expect(first).toMatchObject({ sellerName: "Atelier Émetteur SAS", totalInclTax: "300.00", status: "RECEIVED" });
    expect((await incomingXml(buyer, userId, first.id)).xml.toString("utf8")).toBe(factureXml);

    // Enregistrement en achat : fournisseur créé à partir du SIREN, PDF rattaché.
    const categoryId = (await listCategories(buyer.company.id)).find((c) => c.kind === "EXPENSE")!.id;
    const { purchaseId } = await createPurchaseFromIncoming(buyer, userId, first.id, { categoryId });
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { supplier: true } });
    expect(purchase).toMatchObject({ totalExclTax: expect.anything(), reference: first.number });
    expect(purchase.totalInclTax.toFixed(2)).toBe("300.00");
    expect(purchase.supplier?.siren).toBe("552100554");
    expect(await prisma.documentLink.count({ where: { documentId: first.documentId!, entityType: "PURCHASE", entityId: purchaseId } })).toBe(1);
    await expectAppError(createPurchaseFromIncoming(buyer, userId, first.id, { categoryId }), "EINVOICE_ALREADY_PROCESSED");
    await expectAppError(respondToIncoming(buyer, userId, first.id, { code: 210, reason: "Erreur" }), "EINVOICE_PURCHASE_EXISTS");

    // Refus : motif obligatoire, transmis au fournisseur.
    const second = (await listIncomingInvoices(buyer)).find((i) => i.status === "RECEIVED")!;
    await expect(respondToIncoming(buyer, userId, second.id, { code: 210 })).rejects.toThrow();
    await expectAppError(respondToIncoming(buyer, userId, second.id, { code: 200 }), "VALIDATION_ERROR");
    const refused = await respondToIncoming(buyer, userId, second.id, { code: 210, reason: "Prestation non commandée" });
    expect(refused).toMatchObject({ status: "REFUSED", lastStatus: "Refusée" });
    expect(platform.sent.at(-1)).toMatchObject({ platformRef: "REC-4", direction: "INCOMING", code: 210, reason: "Prestation non commandée" });
    await expectAppError(createPurchaseFromIncoming(buyer, userId, second.id, { categoryId }), "EINVOICE_ALREADY_PROCESSED");
  });
});
