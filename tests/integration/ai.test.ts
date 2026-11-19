import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { LocalStorage, setStorageForTests } from "@/server/storage";
import { resetAiClient } from "@/server/ai/client";
import { aiStatus, setAiEnabled } from "@/server/ai/service";
import { createPurchaseFromDocument, extractDocument, normalizeExtraction, verifiedExtractionSchema, verifyExtraction } from "@/server/ai/documents";
import { decideSuggestions, listCategorySuggestions, suggestCategories } from "@/server/ai/categorization";
import { askAssistant } from "@/server/ai/assistant";
import { plausibleVat, runControls } from "@/server/modules/controls/service";
import { integrationsStatus } from "@/server/modules/admin/integrations";
import { createBankAccount } from "@/server/modules/bank/accounts";
import { listCategories } from "@/server/modules/bank/categories";
import { createManualTransaction, getTransaction } from "@/server/modules/bank/transactions";
import { uploadDocument } from "@/server/modules/documents/service";
import { createPurchase, createSupplier } from "@/server/modules/purchases/service";
import { bankAccountSchema, manualTransactionSchema } from "@/lib/schemas/bank";
import { purchaseSchema, supplierSchema } from "@/lib/schemas/accounting";
import { addDays, todayInParis } from "@/lib/dates";
import { FakeAnthropic } from "../support/fake-anthropic";
import { addMember, createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const fake = new FakeAnthropic();
const saved = { ...process.env };
const today = todayInParis();
const d = (n: number) => addDays(today, -n);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

let userId: string;
let access: CompanyAccess;
let starterAccess: CompanyAccess;
let storageDir: string;
let accountId: string;
let telecomId: string;
let fournituresId: string;

const reload = async () => (access = await authorizeCompany(userId, access.company.id, "company:read"));

beforeAll(async () => {
  await resetDatabase();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "cpd-ia-"));
  setStorageForTests(new LocalStorage(storageDir));
  const base = await fake.start();
  Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: base });
  resetEnvCache();
  resetAiClient();

  const user = await createVerifiedUser({ email: "ia@exemple.test", plan: "PRO" });
  userId = user.id;
  const company = await createTestCompany(userId, "Atelier Lumière");
  access = await authorizeCompany(userId, company.id, "company:read");
  const starter = await createVerifiedUser({ email: "starter@exemple.test", plan: "STARTER" });
  starterAccess = await authorizeCompany(starter.id, (await createTestCompany(starter.id, "Petite Boutique")).id, "company:read");

  const categories = await listCategories(company.id);
  telecomId = categories.find((c) => c.name.startsWith("Télécom"))?.id ?? categories.find((c) => c.kind === "EXPENSE")!.id;
  fournituresId = categories.find((c) => c.kind === "EXPENSE" && c.id !== telecomId)!.id;
  accountId = (await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte courant", openingBalance: "5000", openingBalanceDate: d(90) }))).id;
});

afterAll(async () => {
  await fake.stop();
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  resetAiClient();
  setStorageForTests(undefined);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(() => fake.reset());

describe("activation et quotas", () => {
  it("exige la formule, le consentement de l'entreprise et respecte le quota mensuel", async () => {
    expect(await aiStatus(starterAccess.company)).toMatchObject({ configured: true, included: false, usable: false });
    await expectAppError(setAiEnabled(starterAccess, starterAccess.company.createdById!, true), "PLAN_FEATURE_UNAVAILABLE");

    // Sans consentement : aucun appel à l'API.
    await expectAppError(suggestCategories(access, userId), "AI_DISABLED");
    expect(fake.requests).toHaveLength(0);

    // Un collaborateur ne peut pas activer l'assistant.
    const colleague = await createVerifiedUser({ email: "collegue-ia@exemple.test" });
    await addMember(access.company.id, colleague.id, "COLLABORATOR");
    await expectAppError(setAiEnabled(await authorizeCompany(colleague.id, access.company.id, "company:read"), colleague.id, true), "FORBIDDEN");

    const status = await setAiEnabled(access, userId, true);
    expect(status).toMatchObject({ enabled: true, included: true, usable: true, quota: { used: 0, limit: 300 } });
    expect(await prisma.auditLog.count({ where: { action: "ai.enabled", companyId: access.company.id } })).toBe(1);
    await reload();
  });

  it("refuse au-delà du quota", async () => {
    const usage = Array.from({ length: 300 }, () => ({ companyId: access.company.id, feature: "ASSISTANT" as const, model: "test", status: "OK" as const }));
    await prisma.aiUsage.createMany({ data: usage });
    await expectAppError(askAssistant(access, userId, [{ role: "user", content: "Bonjour" }]), "AI_QUOTA_REACHED");
    expect(fake.requests).toHaveLength(0);
    await prisma.aiUsage.deleteMany({ where: { companyId: access.company.id } });
  });
});

describe("lecture des justificatifs", () => {
  it("contrôle la réponse du modèle (montants, dates, SIREN, catégorie)", () => {
    const ids = new Set([telecomId]);
    const e = normalizeExtraction(
      {
        documentType: "PURCHASE_INVOICE", supplierName: " Opérateur Fibre ", supplierSiren: "123 456 789", supplierVatNumber: "fr 40 552 100 554", invoiceNumber: "F-2026-118",
        issueDate: "2026-02-30", dueDate: null, currency: "eur", totalExclTax: "100,00", totalVat: "20.00", totalInclTax: "125.00",
        vatLines: [{ rate: "20 %", base: "100", amount: "20" }], label: "Abonnement fibre", operationCategory: "SERVICES", suggestedCategoryId: "inconnue", confidence: "high", remarks: ["Document en deux pages"],
      },
      ids,
    );
    expect(e.totalExclTax).toBe("100.00");
    expect(e.issueDate).toBeNull();
    expect(e.supplierSiren).toBeNull();
    expect(e.supplierVatNumber).toBe("FR40552100554");
    expect(e.suggestedCategoryId).toBeNull();
    expect(e.currency).toBe("EUR");
    expect(e.warnings.some((w) => w.includes("ne concordent pas"))).toBe(true);
    expect(e.warnings.some((w) => w.includes("SIREN"))).toBe(true);
    expect(e.warnings).toContain("Document en deux pages");
  });

  it("lit un PDF, attend la vérification, puis crée l'achat sur demande", async () => {
    const { document } = await uploadDocument(access, userId, { fileName: "facture-fibre.pdf", bytes: PDF });
    fake.replyJson({
      documentType: "PURCHASE_INVOICE", supplierName: "Opérateur Fibre", supplierSiren: null, supplierVatNumber: null, invoiceNumber: "F-2026-118",
      issueDate: d(10), dueDate: d(-20), currency: "EUR", totalExclTax: "45.00", totalVat: "9.00", totalInclTax: "54.00",
      vatLines: [{ rate: "20", base: "45.00", amount: "9.00" }], label: "Abonnement fibre", operationCategory: "SERVICES", suggestedCategoryId: telecomId, confidence: "high", remarks: [],
    });
    const state = await extractDocument(access, userId, document.id);
    expect(state).toMatchObject({ status: "DONE", verifiedAt: null, extraction: { totalInclTax: "54.00", suggestedCategoryId: telecomId, warnings: [] } });

    // Requête réellement émise par le SDK : PDF en base64, sortie structurée, repli en cas de refus.
    const [request] = fake.requests;
    const body = request.body as { model: string; messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>; output_config: { format: { type: string }; effort: string }; fallbacks: string };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(body.fallbacks).toBe("default");
    expect(String(request.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");

    // Rien n'est créé tant que la lecture n'est pas vérifiée.
    await expectAppError(createPurchaseFromDocument(access, userId, document.id), "EXTRACTION_NOT_VERIFIED");
    expect(await prisma.purchase.count({ where: { companyId: access.company.id } })).toBe(0);

    // L'utilisateur corrige le montant HT avant de valider.
    const verified = await verifyExtraction(access, userId, document.id, verifiedExtractionSchema.parse({ documentType: "PURCHASE_INVOICE", supplierName: "Opérateur Fibre", invoiceNumber: "F-2026-118", issueDate: d(10), totalExclTax: "46.00", totalVat: "9.20", label: "Abonnement fibre", categoryId: telecomId }));
    expect(verified.extraction).toMatchObject({ totalExclTax: "46.00", totalInclTax: "55.20" });
    expect((await prisma.auditLog.findFirst({ where: { action: "document.ai_extraction_verified", entityId: document.id } }))?.metadata).toMatchObject({ detail: expect.stringContaining("totalExclTax") });

    const purchase = await createPurchaseFromDocument(access, userId, document.id);
    expect(purchase).toMatchObject({ reference: "F-2026-118", totalExclTax: "46.00", totalInclTax: "55.20" });
    expect(await prisma.supplier.count({ where: { companyId: access.company.id, name: "Opérateur Fibre" } })).toBe(1);
    expect(await prisma.documentLink.count({ where: { documentId: document.id, entityType: "PURCHASE", entityId: purchase.id } })).toBe(1);
    await expectAppError(createPurchaseFromDocument(access, userId, document.id), "ALREADY_LINKED");

    const usage = await prisma.aiUsage.findFirst({ where: { companyId: access.company.id, feature: "DOCUMENT_EXTRACTION" } });
    expect(usage).toMatchObject({ status: "OK", inputTokens: 1200, outputTokens: 150 });
  });

  it("consigne un refus sans rien enregistrer", async () => {
    const { document } = await uploadDocument(access, userId, { fileName: "autre.pdf", bytes: Buffer.concat([PDF, Buffer.from("% autre")]) });
    fake.reply(() => ({ content: [], stop_reason: "refusal" }));
    await expectAppError(extractDocument(access, userId, document.id), "AI_REFUSED");
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).ocrStatus).toBe("FAILED");
    expect(await prisma.aiUsage.count({ where: { companyId: access.company.id, status: "REFUSED" } })).toBe(1);
  });

  it("traduit une indisponibilité de l'API", async () => {
    const { document } = await uploadDocument(access, userId, { fileName: "trois.pdf", bytes: Buffer.concat([PDF, Buffer.from("% trois")]) });
    fake.reply(() => ({ content: [], status: 529, error: { type: "overloaded_error", message: "Overloaded" } }));
    await expectAppError(extractDocument(access, userId, document.id), "AI_UNAVAILABLE");
  });
});

describe("suggestions de catégories", () => {
  it("propose sans appliquer, puis applique uniquement ce qui est accepté", async () => {
    const mk = (label: string, amount: string, direction: "IN" | "OUT" = "OUT") => createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d(5), label, direction, amount }));
    const box = await mk("PRLV OPERATEUR FIBRE", "54.00");
    const paper = await mk("CB PAPETERIE CENTRALE", "32.50");
    const client = await mk("VIR CLIENT DURAND", "1200", "IN");

    fake.reply((request) => {
      const text = JSON.stringify(request.messages);
      expect(text).toContain("PRLV OPERATEUR FIBRE");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              suggestions: [
                { transactionId: box.id, categoryId: telecomId, vatRate: "20", confidence: "high", reason: "Abonnement internet" },
                { transactionId: paper.id, categoryId: fournituresId, vatRate: "12", confidence: "medium", reason: "Achat en papeterie" },
                // Incohérent (recette classée en dépense) ou inconnu : écartés par le serveur.
                { transactionId: client.id, categoryId: telecomId, vatRate: null, confidence: "low", reason: "?" },
                { transactionId: "bt-inconnue", categoryId: telecomId, vatRate: null, confidence: "low", reason: "?" },
              ],
            }),
          },
        ],
      };
    });
    expect(await suggestCategories(access, userId)).toEqual({ requested: 3, suggested: 2 });
    expect((await getTransaction(access, box.id)).category).toBeNull();

    const list = await listCategorySuggestions(access);
    expect(list).toHaveLength(2);
    const boxSuggestion = list.find((s) => s.transaction.id === box.id)!;
    expect(boxSuggestion).toMatchObject({ vatRate: "20.00", confidence: "high" });
    expect(list.find((s) => s.transaction.id === paper.id)!.vatRate).toBeNull();

    // Pas de nouvelle demande pour des opérations déjà en attente.
    expect(await suggestCategories(access, userId, { transactionIds: [box.id, paper.id] })).toEqual({ requested: 0, suggested: 0 });

    await decideSuggestions(access, userId, { ids: [boxSuggestion.id], decision: "accept" });
    const updated = await getTransaction(access, box.id);
    expect(updated.category?.id).toBe(telecomId);
    expect(updated.vatRate).toBe("20");
    expect(await prisma.auditLog.count({ where: { action: "bank.transaction.update", entityId: box.id } })).toBe(1);

    const paperSuggestion = list.find((s) => s.transaction.id === paper.id)!;
    await decideSuggestions(access, userId, { ids: [paperSuggestion.id], decision: "reject" });
    expect((await getTransaction(access, paper.id)).category).toBeNull();
    expect(await listCategorySuggestions(access)).toHaveLength(0);
    await expectAppError(decideSuggestions(access, userId, { ids: [paperSuggestion.id], decision: "accept" }), "NOT_FOUND");
  });

  it("isole les suggestions par entreprise", async () => {
    const other = await createVerifiedUser({ email: "autre-ia@exemple.test", plan: "PRO" });
    const otherAccess = await authorizeCompany(other.id, (await createTestCompany(other.id, "Autre Atelier")).id, "company:read");
    const pending = await prisma.aiSuggestion.findMany({ where: { companyId: access.company.id }, select: { id: true } });
    await expectAppError(decideSuggestions(otherAccess, other.id, { ids: [pending[0].id], decision: "reject" }), "NOT_FOUND");
  });
});

describe("assistant", () => {
  it("répond en s'appuyant sur des outils en lecture seule, limités aux droits", async () => {
    fake.reply((request) => {
      const tools = (request.tools as Array<{ name: string }>).map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(["indicateurs", "rechercher_operations", "rechercher_factures", "rechercher_achats", "controles"]));
      return { content: [{ type: "tool_use", id: "toolu_1", name: "rechercher_operations", input: { texte: "FIBRE" } }] };
    });
    fake.reply((request) => {
      const messages = request.messages as Array<{ role: string; content: unknown }>;
      const toolResult = JSON.stringify(messages.at(-1)!.content);
      // Pas de fil conservé côté fournisseur : l'historique complet et les outils sont renvoyés.
      expect(request.thread).toBeUndefined();
      expect(Array.isArray(request.tools)).toBe(true);
      expect(messages).toHaveLength(3);
      expect(toolResult).toContain("PRLV OPERATEUR FIBRE");
      expect(toolResult).toContain("-54,00 €");
      return { content: [{ type: "text", text: "Le prélèvement de l'opérateur fibre s'élève à 54,00 €." }] };
    });
    const reply = await askAssistant(access, userId, [{ role: "user", content: "Combien me coûte la fibre ?" }]);
    expect(reply.answer).toContain("54,00 €");
    expect(reply.sources[0]).toMatchObject({ href: expect.stringMatching(/^\/app\/banque\/operations\//) });
    expect(await prisma.aiUsage.findFirst({ where: { feature: "ASSISTANT", companyId: access.company.id }, orderBy: { createdAt: "desc" } })).toMatchObject({ status: "OK", inputTokens: 2400 });

    // Un rôle lecture seule sans accès à la banque n'a pas l'outil correspondant.
    const reader = await createVerifiedUser({ email: "lecteur-ia@exemple.test" });
    await addMember(access.company.id, reader.id, "EXTERNAL_ACCOUNTANT");
    const readerAccess = await authorizeCompany(reader.id, access.company.id, "company:read");
    readerAccess.permissions.delete("bank:read");
    fake.reply((request) => {
      expect((request.tools as Array<{ name: string }>).map((t) => t.name)).not.toContain("rechercher_operations");
      return { content: [{ type: "text", text: "D'accord." }] };
    });
    await askAssistant(readerAccess, reader.id, [{ role: "user", content: "Bonjour" }]);
  });
});

describe("contrôles automatiques", () => {
  it("vérifie la vraisemblance d'un taux de TVA", () => {
    expect(plausibleVat("100", "20")).toBe(true);
    expect(plausibleVat("100", "5.5")).toBe(true);
    expect(plausibleVat("100", "0")).toBe(true);
    expect(plausibleVat("100", "12.30")).toBe(true); // plusieurs taux possibles
    expect(plausibleVat("100", "35")).toBe(false);
    expect(plausibleVat("100", "1")).toBe(false);
  });

  it("signale doublons, TVA inhabituelle et dépenses sans justificatif", async () => {
    const supplier = await createSupplier(access, userId, supplierSchema.parse({ name: "Imprimerie Nord" }));
    const p = (ref: string, date: string, ht: string, vat: string) => createPurchase(access, userId, purchaseSchema.parse({ supplierId: supplier.id, reference: ref, label: "Impression", issueDate: date, categoryId: fournituresId, totalExclTax: ht, totalVat: vat }));
    await p("IN-1", d(40), "100", "20");
    await p("IN-2", d(38), "100", "20");
    await p("IN-3", d(20), "200", "70");
    await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d(15), label: "CB RESTAURANT DU PORT", direction: "OUT", amount: "48.00" }));
    const findings = await runControls(access);
    const codes = findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["PURCHASE_DUPLICATES", "VAT_INCONSISTENT", "MISSING_RECEIPTS"]));
    expect(findings.find((f) => f.code === "VAT_INCONSISTENT")!.items[0].label).toContain("35.0 %");
    // Le contrôle ne modifie rien.
    expect(await prisma.purchase.count({ where: { companyId: access.company.id, status: "CANCELLED" } })).toBe(0);
  });
});

describe("supervision", () => {
  it("vérifie la clé et le modèle sans consommer de requête, et résume l'usage", async () => {
    const status = await integrationsStatus();
    expect(status.ai).toMatchObject({ configured: true, ok: true, model: "claude-opus-5-5" });
    expect(status.ai.requests30d).toBeGreaterThan(0);
    expect(fake.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(0);
  });
});
