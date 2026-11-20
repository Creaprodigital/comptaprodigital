import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { createCustomer } from "@/server/modules/customers/service";
import { createCreditNote, createInvoiceDraft, getInvoiceDetail, issueInvoice } from "@/server/modules/invoicing/invoices";
import { convertQuote, createQuote, setQuoteStatus } from "@/server/modules/invoicing/quotes";
import { updateBillingSettings } from "@/server/modules/invoicing/settings";
import { buildFacturX, unitCode } from "@/server/modules/invoicing/facturx";
import { renderInvoicePdf } from "@/server/modules/invoicing/invoice-pdf";
import { billingSettingsSchema, customerSchema, invoiceSchema, quoteSchema, type DocumentLineInput } from "@/lib/schemas/invoicing";
import { todayInParis } from "@/lib/dates";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

/**
 * Factur-X : chaque XML produit est validé par les schémas XSD officiels (structure) et par les
 * règles métier officielles EN 16931 + Factur-X (schématron compilé, exécuté avec SaxonJS),
 * comme le font les plateformes de dématérialisation.
 */

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "facturx");
const XSD = path.join(FIXTURES, "Factur-X_1.09_EN16931.xsd");
const require = createRequire(import.meta.url);
const SaxonJS = require("saxon-js") as { transform(options: Record<string, unknown>, mode: "sync"): { principalResult: string } };
const sef = JSON.parse(gunzipSync(readFileSync(path.join(FIXTURES, "FACTUR-X_EN16931.sef.json.gz"))).toString("utf8"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "cpd-facturx-"));

/** Validation XSD par xmllint : retourne les erreurs (vide si valide). */
function xsdErrors(xml: string): string[] {
  const file = path.join(tmp, `f-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(file, xml);
  try {
    execFileSync("xmllint", ["--noout", "--nonet", "--schema", XSD, file], { stdio: "pipe" });
    return [];
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error).split("\n").filter((l) => l.includes("error"));
  }
}

/** Règles métier : assertions en échec de niveau « fatal » ou « error » dans le rapport SVRL. */
function schematronErrors(xml: string): string[] {
  const { principalResult } = SaxonJS.transform({ stylesheetInternal: sef, stylesheetBaseURI: `file://${FIXTURES}/FACTUR-X_EN16931.xslt`, sourceText: xml, destination: "serialized" }, "sync");
  const failures = [...principalResult.matchAll(/<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g)];
  return failures
    .filter(([, attributes]) => !/flag="warning"/.test(attributes))
    .map(([, attributes, body]) => `${/id="([^"]+)"/.exec(attributes)?.[1] ?? "?"} : ${(/<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(body)?.[1] ?? "").replace(/\s+/g, " ").trim()}`);
}

function expectConform(xml: string) {
  expect(xsdErrors(xml)).toEqual([]);
  expect(schematronErrors(xml)).toEqual([]);
}

/** Fichier incorporé « factur-x.xml » d'un PDF produit par PDFKit (flux compressé). */
function embeddedXml(pdf: Buffer): string {
  const text = pdf.toString("latin1");
  const at = text.indexOf("/Type /EmbeddedFile");
  expect(at).toBeGreaterThan(-1);
  const start = text.indexOf("stream", at) + "stream".length;
  const begin = text[start] === "\r" ? start + 2 : start + 1;
  const end = text.indexOf("endstream", begin);
  const raw = pdf.subarray(begin, end);
  // Flux compressé (en-tête zlib 0x78) ou brut.
  return (raw[0] === 0x78 ? inflateSync(raw) : raw).toString("utf8").trim();
}

const today = todayInParis();
let access: CompanyAccess;
let userId: string;
let customerId: string;
const line = (o: Partial<DocumentLineInput> = {}): DocumentLineInput => ({ description: "Accompagnement", quantity: "1", unitPriceExclTax: "100", discountRate: "0", vatRate: "20", ...o });

beforeAll(async () => {
  await resetDatabase();
  const user = await createVerifiedUser({ email: "facturx@exemple.test", plan: "PRO" });
  userId = user.id;
  const company = await createTestCompany(userId, "Atelier Numérique SAS", { siren: "552100554", addressLine1: "12 rue des Lilas", postalCode: "69003", city: "Lyon" });
  access = await authorizeCompany(userId, company.id, "company:read");
  await updateBillingSettings(access, userId, billingSettingsSchema.parse({ invoicePrefix: "F", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30, rcsCity: "Lyon", shareCapital: "10000", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP" }));
  access = await authorizeCompany(userId, company.id, "company:read");
  customerId = (await createCustomer(access, userId, customerSchema.parse({ name: "Maison Verdier SARL", siren: "732829320", email: "compta@verdier.test", addressLine1: "4 place Bellecour", postalCode: "69002", city: "Lyon" }))).id;
});

describe("codes d'unité", () => {
  it("convertit les unités usuelles en codes UN/ECE", () => {
    expect([unitCode("heure"), unitCode("Jours"), unitCode("kg"), unitCode("m²"), unitCode("forfait"), unitCode(null)]).toEqual(["HUR", "DAY", "KGM", "MTK", "C62", "C62"]);
  });
});

describe("factures conformes EN 16931", () => {
  it("facture à plusieurs taux, remise de ligne et remise globale", async () => {
    const draft = await createInvoiceDraft(
      access,
      userId,
      invoiceSchema.parse({
        customerId,
        issueDate: today,
        serviceDate: today,
        subject: "Refonte du site",
        discountType: "PERCENT",
        discountValue: "5",
        items: [
          line({ description: "Conseil", quantity: "2.5", unit: "heure", unitPriceExclTax: "75", discountRate: "10" }),
          line({ description: "Matériel", quantity: "3", unit: "pièce", unitPriceExclTax: "19.99", vatRate: "10" }),
          line({ description: "Livres", quantity: "1", unitPriceExclTax: "42.10", vatRate: "5.5" }),
        ],
      }),
    );
    const invoice = await issueInvoice(access, userId, draft.id);
    const { xml, problems } = buildFacturX(access.company, invoice);
    expect(problems).toEqual([]);
    expectConform(xml);
    expect(xml).toContain('<ram:BilledQuantity unitCode="HUR">2.5</ram:BilledQuantity>');
    expect(xml).toContain(`<ram:GrandTotalAmount>${invoice.totalInclTax.toFixed(2)}</ram:GrandTotalAmount>`);
    expect(xml).toContain("<ram:IBANID>FR7630006000011234567890189</ram:IBANID>");

    // PDF/A-3 avec le XML incorporé, polices incorporées.
    const { pdf, facturX } = await renderInvoicePdf(access, await getInvoiceDetail(access, invoice.id));
    expect(facturX).toEqual({ embedded: true, problems: [] });
    const raw = pdf.toString("latin1");
    expect(raw).toContain("/AFRelationship /Alternative");
    expect(raw).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(raw).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(raw).toContain("/OutputIntents");
    expect(raw).toMatch(/\/FontFile2/);
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    expect(embeddedXml(pdf)).toBe(xml.trim());
    // Archivage de l'original au format Factur-X.
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).eInvoiceFormat).toBe("FACTUR_X");

    // Avoir partiel sur cette facture : type 381 et facture d'origine référencée.
    const creditDraft = await createCreditNote(access, userId, invoice.id, { reason: "Geste commercial", items: [line({ description: "Remise accordée", unitPriceExclTax: "20" })] });
    const credit = await issueInvoice(access, userId, creditDraft.id);
    const creditXml = buildFacturX(access.company, credit);
    expect(creditXml.problems).toEqual([]);
    expectConform(creditXml.xml);
    expect(creditXml.xml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(creditXml.xml).toContain(`<ram:IssuerAssignedID>${invoice.number}</ram:IssuerAssignedID>`);
  });

  it("facture d'acompte puis facture finale, acompte déduit", async () => {
    const quote = await createQuote(access, userId, quoteSchema.parse({ customerId, issueDate: today, items: [line({ unitPriceExclTax: "1000" }), line({ description: "Hébergement", unitPriceExclTax: "500", vatRate: "10" })], discountType: "PERCENT", discountValue: "10" }));
    await setQuoteStatus(access, userId, quote.id, "SENT");
    const deposit = await issueInvoice(access, userId, (await convertQuote(access, userId, quote.id, { mode: "deposit", percent: "30" })).id);
    const depositXml = buildFacturX(access.company, deposit);
    expect(depositXml.problems).toEqual([]);
    expectConform(depositXml.xml);
    expect(depositXml.xml).toContain("<ram:TypeCode>386</ram:TypeCode>");

    const final = await issueInvoice(access, userId, (await convertQuote(access, userId, quote.id, { mode: "invoice" })).id);
    const finalXml = buildFacturX(access.company, final);
    expect(finalXml.problems).toEqual([]);
    expectConform(finalXml.xml);
    expect(finalXml.xml).toContain("<ram:GrandTotalAmount>1102.50</ram:GrandTotalAmount>");
  });

  it("micro-entreprise en franchise de TVA : catégorie E et mention de l'article 293 B", async () => {
    const owner = await createVerifiedUser({ email: "franchise-fx@exemple.test", plan: "PRO" });
    const micro = await createTestCompany(owner.id, "Studio Lumière", { legalForm: "EI", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE", siren: "802954784", addressLine1: "3 rue Neuve", postalCode: "75011", city: "Paris" });
    const microAccess = await authorizeCompany(owner.id, micro.id, "company:read");
    const client = await createCustomer(microAccess, owner.id, customerSchema.parse({ name: "Client Particulier", type: "INDIVIDUAL", addressLine1: "1 rue Haute", postalCode: "75001", city: "Paris" }));
    const draft = await createInvoiceDraft(microAccess, owner.id, invoiceSchema.parse({ customerId: client.id, issueDate: today, items: [line({ unitPriceExclTax: "350", vatRate: "0" })] }));
    const invoice = await issueInvoice(microAccess, owner.id, draft.id);
    const { xml, problems } = buildFacturX(microAccess.company, invoice);
    expect(problems).toEqual([]);
    expectConform(xml);
    expect(xml).toContain("<ram:CategoryCode>E</ram:CategoryCode>");
    expect(xml).toContain("<ram:ExemptionReasonCode>VATEX-FR-FRANCHISE</ram:ExemptionReasonCode>");
  });
});

describe("factures non conformes", () => {
  it("sans numéro de TVA du vendeur, la facture reste un PDF simple et la raison est donnée", async () => {
    await prisma.company.update({ where: { id: access.company.id }, data: { vatNumber: null } });
    const noVat = await authorizeCompany(userId, access.company.id, "company:read");
    const invoice = await issueInvoice(noVat, userId, (await createInvoiceDraft(noVat, userId, invoiceSchema.parse({ customerId, issueDate: today, items: [line()] }))).id);
    const { problems } = buildFacturX(noVat.company, invoice);
    expect(problems.join(" ")).toContain("BR-S-02");
    const { pdf, facturX } = await renderInvoicePdf(noVat, invoice);
    expect(facturX.embedded).toBe(false);
    expect(pdf.toString("latin1")).not.toContain("factur-x.xml");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).eInvoiceFormat).toBeNull();
    // Le contrôle de l'application et les règles officielles concordent.
    expect(schematronErrors(buildFacturX(noVat.company, invoice).xml).join(" ")).toMatch(/BR-S-02/);
  });

  it("un brouillon n'a pas de version électronique", async () => {
    const draft = await createInvoiceDraft(access, userId, invoiceSchema.parse({ customerId, issueDate: today, items: [line()] }));
    const { facturX } = await renderInvoicePdf(access, draft);
    expect(facturX).toEqual({ embedded: false, problems: [] });
    rmSync(tmp, { recursive: true, force: true });
  });
});
