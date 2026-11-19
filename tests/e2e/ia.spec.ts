import { expect, test } from "@playwright/test";
import { createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n% facture hebergeur\n");

/**
 * Assistant IA de bout en bout. L'API Anthropic est remplacée par un faux serveur local
 * (tests/support/fake-anthropic-auto.ts) : l'application, elle, fonctionne comme en production.
 */
test("assistant IA : consentement, lecture vérifiée d'un justificatif, suggestions validées, questions", async ({ page }) => {
  await createAccountViaApi(page.request, uniqueEmail("ia"), "PRO");
  const companyId = await createCompanyViaApi(page.request, "Studio Nuage");

  await test.step("rien ne part vers l'IA sans activation par l'entreprise", async () => {
    const refused = await page.request.post(`/api/v1/companies/${companyId}/assistant`, { data: { messages: [{ role: "user", content: "Bonjour" }] } });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("AI_DISABLED");
    await page.goto("/app/assistant");
    await expect(page.getByText("L'assistant IA n'est pas activé pour cette entreprise")).toBeVisible();
  });

  await test.step("le titulaire active l'assistant en donnant son accord", async () => {
    await page.goto("/app/entreprise/parametres");
    const activate = page.getByRole("button", { name: "Activer l'assistant" });
    await expect(activate).toBeDisabled();
    await page.getByLabel("J'accepte que les données nécessaires soient transmises à Anthropic").check();
    await activate.click();
    await expect(page.getByText("Assistant IA activé.")).toBeVisible();
    await expect(page.getByText(/Utilisation ce mois-ci : 0/)).toBeVisible();
  });

  await test.step("lecture d'un justificatif, vérification, puis création de l'achat", async () => {
    const upload = await page.request.post(`/api/v1/companies/${companyId}/documents`, { multipart: { file: { name: "facture-hebergeur.pdf", mimeType: "application/pdf", buffer: PDF } } });
    expect(upload.status()).toBe(201);
    const documentId = (await upload.json()).data.document.id as string;
    await page.goto(`/app/documents/${documentId}`);
    await page.getByRole("button", { name: "Lire le document" }).click();
    await expect(page.getByText("À vérifier")).toBeVisible();
    await expect(page.getByLabel("Numéro de facture")).toHaveValue("HN-2026-0042");
    await expect(page.getByRole("button", { name: "Créer la facture d'achat" })).toHaveCount(0);

    await page.getByLabel("Total HT (€)").fill("26.00");
    await page.getByLabel("TVA (€)").fill("5.20");
    await page.getByRole("button", { name: "Valider ces informations" }).click();
    await expect(page.getByText("Lecture vérifiée.")).toBeVisible();
    await page.getByRole("button", { name: "Créer la facture d'achat" }).click();
    await expect(page.getByText("Facture d'achat créée.")).toBeVisible();
    await expect(page.getByText("Facture d'achat associée")).toBeVisible();
    const purchases = await page.request.get(`/api/v1/companies/${companyId}/purchases`);
    expect(JSON.stringify(await purchases.json())).toContain("31.20");
  });

  await test.step("suggestions de catégories : rien n'est appliqué avant acceptation", async () => {
    const account = await page.request.post(`/api/v1/companies/${companyId}/bank/accounts`, { data: { name: "Compte pro" } });
    const accountId = (await account.json()).data.id as string;
    const tx = await page.request.post(`/api/v1/companies/${companyId}/bank/transactions`, { data: { bankAccountId: accountId, date: day(3), label: "PRLV HEBERGEUR NUAGE", direction: "OUT", amount: "30" } });
    const transactionId = (await tx.json()).data.id as string;

    await page.goto("/app/banque/suggestions");
    await page.getByRole("button", { name: "Proposer des catégories" }).click();
    await expect(page.getByText(/1 suggestion\(s\) pour 1 opération/)).toBeVisible();
    const detail = await page.request.get(`/api/v1/companies/${companyId}/bank/transactions/${transactionId}`);
    expect((await detail.json()).data.transaction.category).toBeNull();

    await page.getByRole("button", { name: "Accepter pour PRLV HEBERGEUR NUAGE" }).click();
    await expect(page.getByText("1 opération(s) catégorisée(s).")).toBeVisible();
    const after = await page.request.get(`/api/v1/companies/${companyId}/bank/transactions/${transactionId}`);
    expect((await after.json()).data.transaction.category).not.toBeNull();
  });

  await test.step("questions à l'assistant et contrôles", async () => {
    await page.goto("/app/assistant");
    await page.getByLabel("Votre question").fill("Qu'est-ce que je dois vérifier ?");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("J'ai consulté les contrôles de l'entreprise")).toBeVisible();
    await expect(page.getByRole("link", { name: "Contrôles" }).last()).toBeVisible();

    await page.goto("/app/controles");
    await expect(page.getByRole("heading", { name: "Contrôles" })).toBeVisible();

    await page.goto("/app/entreprise/parametres");
    await expect(page.getByText(/Utilisation ce mois-ci : 3/)).toBeVisible();
  });
});
