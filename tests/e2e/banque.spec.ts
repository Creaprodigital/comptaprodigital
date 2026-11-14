import { expect, test } from "@playwright/test";
import { createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const fr = (iso: string) => iso.split("-").reverse().join("/");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");

test("banque : compte, règle, import d'un relevé, justificatif, rapprochement d'une facture et documents", async ({ page }) => {
  test.setTimeout(180_000);
  await createAccountViaApi(page.request, uniqueEmail("banque"), "PRO");
  const companyId = await createCompanyViaApi(page.request, "Atelier Banque E2E");
  page.on("dialog", (dialog) => void dialog.accept());

  // Une facture émise de 1 200 € TTC, à rapprocher de l'encaissement du relevé.
  const customer = await page.request.post(`/api/v1/companies/${companyId}/customers`, { data: { name: "Maison Verdier" } });
  const customerId = (await customer.json()).data.id as string;
  const draft = await page.request.post(`/api/v1/companies/${companyId}/invoices`, {
    data: { customerId, issueDate: day(3), items: [{ description: "Prestation", quantity: "1", unitPriceExclTax: "1000", discountRate: "0", vatRate: "20" }] },
  });
  const invoiceId = (await draft.json()).data.id as string;
  const issued = await page.request.post(`/api/v1/companies/${companyId}/invoices/${invoiceId}/issue`);
  const invoiceNumber = (await issued.json()).data.number as string;

  const statement = ["Date;Libellé;Débit;Crédit", `${fr(day(2))};VIR SEPA MAISON VERDIER ${invoiceNumber};;1 200,00`, `${fr(day(2))};PRLV SEPA OPERATEUR TELECOM;115,20;`, `${fr(day(1))};CB PAPETERIE CENTRALE;84,90;`].join("\n");

  await test.step("compte bancaire : IBAN contrôlé, puis masqué", async () => {
    await page.goto("/app/banque");
    await expect(page.getByText("Aucun compte bancaire")).toBeVisible();
    await page.goto("/app/banque/comptes");
    await page.getByRole("button", { name: "Ajouter un compte" }).first().click();
    await page.getByLabel("Nom du compte").fill("Compte courant");
    await page.getByLabel("IBAN").fill("FR76 3000 6000 0112 3456 7890 188");
    await page.getByRole("button", { name: "Ajouter le compte" }).click();
    await expect(page.getByText("IBAN invalide")).toBeVisible();
    await page.getByLabel("IBAN").fill("FR76 3000 6000 0112 3456 7890 189");
    await page.getByLabel("Solde d'ouverture", { exact: true }).fill("1 000,00");
    await page.getByRole("button", { name: "Ajouter le compte" }).click();
    await expect(page.getByText("IBAN •••• 0189")).toBeVisible();
    await expect(page.getByText("3000 6000")).toHaveCount(0);
  });

  await test.step("règle de catégorisation", async () => {
    await page.goto("/app/banque/regles");
    await page.getByRole("button", { name: "Nouvelle règle" }).click();
    await page.getByLabel("Nom de la règle").fill("Téléphonie");
    await page.getByLabel("Texte recherché").fill("opérateur télécom");
    await page.getByLabel("Catégorie à appliquer").selectOption({ label: "Télécom et internet" });
    await page.getByLabel("TVA").selectOption("20");
    await page.getByRole("button", { name: "Créer la règle" }).click();
    await expect(page.getByText("Le libellé contient « opérateur télécom »")).toBeVisible();
  });

  await test.step("import du relevé : aperçu, import, puis doublons ignorés", async () => {
    await page.goto("/app/banque/import");
    await page.getByLabel("Relevé bancaire").setInputFiles({ name: "releve.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText("Un relevé au format PDF ne peut pas être importé")).toBeVisible();

    await page.getByLabel("Relevé bancaire").setInputFiles({ name: "novembre.csv", mimeType: "text/csv", buffer: Buffer.from(statement, "latin1") });
    await expect(page.getByText("Format reconnu : CSV")).toBeVisible();
    await page.getByRole("button", { name: "Importer 3 opérations" }).click();
    await expect(page.getByText("3 opérations importées")).toBeVisible();
    await expect(page.getByText("1 catégorisée par vos règles.")).toBeVisible();

    await page.getByRole("button", { name: "Importer un autre relevé" }).click();
    await page.getByLabel("Relevé bancaire").setInputFiles({ name: "novembre.csv", mimeType: "text/csv", buffer: Buffer.from(statement, "latin1") });
    await expect(page.getByText("Ce fichier a déjà été importé sur ce compte")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aucune opération nouvelle" })).toBeDisabled();
  });

  await test.step("liste : solde, filtres et catégorisation d'une sélection", async () => {
    await page.goto("/app/banque");
    await expect(page.getByText(/1\s999,90\s€/)).toBeVisible(); // 1 000 + 1 200 − 115,20 − 84,90
    await page.getByRole("link", { name: /Sans justificatif/ }).click();
    await expect(page.getByRole("link", { name: "CB PAPETERIE CENTRALE" })).toBeVisible();
    await expect(page.getByRole("link", { name: /VIR SEPA MAISON VERDIER/ })).toHaveCount(0);

    await page.getByLabel("Sélectionner CB PAPETERIE CENTRALE").check();
    await page.getByLabel("Catégorie à appliquer").selectOption({ label: "Fournitures et petit équipement" });
    await page.getByRole("button", { name: "Catégoriser la sélection" }).click();
    await expect(page.getByText("1 opération catégorisée.")).toBeVisible();
  });

  await test.step("justificatif : ajout, aperçu, opération rapprochée", async () => {
    await page.goto("/app/banque?q=telecom");
    await page.getByRole("link", { name: "PRLV SEPA OPERATEUR TELECOM" }).click();
    await expect(page.getByText("Catégorie « Télécom et internet » appliquée par la règle « Téléphonie »")).toBeVisible();
    await expect(page.getByText("Cette dépense n'a pas encore de justificatif.")).toBeVisible();

    await page.getByRole("button", { name: "Ajouter un justificatif" }).click();
    await page.getByLabel("Fichiers").setInputFiles({ name: "programme.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ programme déguisé en PDF") });
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("seuls les fichiers PDF, JPEG et PNG sont acceptés")).toBeVisible();
    await page.getByLabel("Fichiers").setInputFiles({ name: "facture-operateur.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("1 document ajouté.")).toBeVisible();
    await expect(page.getByText("Justificatif « facture-operateur » associé")).toBeVisible();
    await expect(page.getByText("Cette dépense n'a pas encore de justificatif.")).toHaveCount(0);

    await page.getByRole("button", { name: "facture-operateur", exact: true }).click();
    await expect(page.locator("iframe[title='Aperçu de facture-operateur']")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("rapprochement de l'encaissement avec la facture, puis annulation", async () => {
    await page.goto("/app/banque?sens=IN");
    await page.getByRole("link", { name: /VIR SEPA MAISON VERDIER/ }).click();
    await expect(page.getByText("Numéro de facture dans le libellé")).toBeVisible();
    await page.getByLabel(`Rapprocher la facture ${invoiceNumber}`).check();
    await expect(page.getByText("L'opération sera entièrement rapprochée.")).toBeVisible();
    await page.getByRole("button", { name: "Rapprocher", exact: true }).click();
    await expect(page.getByText("Opération rapprochée.")).toBeVisible();
    await expect(page.getByText(`Rapprochement : 1200,00 € sur la facture ${invoiceNumber}`)).toBeVisible();

    await page.getByRole("link", { name: `Facture ${invoiceNumber}` }).click();
    await expect(page.getByText("Payée").first()).toBeVisible();

    await page.goBack();
    await page.getByRole("button", { name: "Annuler le rapprochement" }).click();
    await expect(page.getByText("Rapprochement annulé.")).toBeVisible();
    const invoice = await page.request.get(`/api/v1/companies/${companyId}/invoices/${invoiceId}`);
    expect((await invoice.json()).data).toMatchObject({ status: "ISSUED", amountPaid: "0.00" });
  });

  await test.step("documents : bibliothèque, original de la facture archivé, téléchargement et export", async () => {
    await page.goto("/app/documents");
    await expect(page.getByRole("button", { name: "facture-operateur", exact: true })).toBeVisible();
    await expect(page.getByText("Original archivé")).toBeVisible();
    await expect(page.getByRole("link", { name: /Opération du .* PRLV SEPA OPERATEUR TELECOM/ })).toBeVisible();

    const list = await page.request.get(`/api/v1/companies/${companyId}/documents?category=PURCHASE_INVOICE`);
    const documentId = (await list.json()).data.items[0].id as string;
    const content = await page.request.get(`/api/v1/companies/${companyId}/documents/${documentId}/content?download=1`);
    expect(content.headers()["content-type"]).toBe("application/pdf");
    expect(content.headers()["content-disposition"]).toContain("attachment");
    expect(content.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect((await content.body()).equals(PDF)).toBe(true);

    const archive = await page.request.get(`/api/v1/companies/${companyId}/documents/export`);
    expect(archive.headers()["content-type"]).toBe("application/zip");
    expect((await archive.body()).subarray(0, 2).toString()).toBe("PK");

    await page.getByRole("button", { name: "Supprimer facture-operateur" }).click();
    await expect(page.getByText("Document supprimé.")).toBeVisible();
    await expect(page.getByRole("button", { name: "facture-operateur", exact: true })).toHaveCount(0);
  });
});

test("banque : cloisonnement entre entreprises et formule Starter", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await createAccountViaApi(page.request, uniqueEmail("banque-a"), "PRO");
  const companyId = await createCompanyViaApi(page.request, "Entreprise A");
  const account = await page.request.post(`/api/v1/companies/${companyId}/bank/accounts`, { data: { name: "Compte A" } });
  const accountId = (await account.json()).data.id as string;
  const created = await page.request.post(`/api/v1/companies/${companyId}/bank/transactions`, { data: { bankAccountId: accountId, date: day(1), label: "Achat confidentiel", direction: "OUT", amount: "42" } });
  const transactionId = (await created.json()).data.id as string;
  const upload = await page.request.post(`/api/v1/companies/${companyId}/documents`, { multipart: { file: { name: "piece.pdf", mimeType: "application/pdf", buffer: PDF }, entityType: "BANK_TRANSACTION", entityId: transactionId } });
  expect(upload.status()).toBe(201);
  const documentId = (await upload.json()).data.document.id as string;

  // Un autre compte, sur la formule Starter, dans une autre entreprise.
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
  const other = await context.newPage();
  await createAccountViaApi(other.request, uniqueEmail("banque-b"), "STARTER");
  const otherCompanyId = await createCompanyViaApi(other.request, "Entreprise B");

  for (const path of [`/bank/transactions`, `/bank/transactions/${transactionId}`, `/bank/accounts`, `/documents`, `/documents/${documentId}`, `/documents/${documentId}/content`, `/documents/export`]) {
    expect((await other.request.get(`/api/v1/companies/${companyId}${path}`)).status(), path).toBe(404);
  }
  expect((await other.request.delete(`/api/v1/companies/${companyId}/bank/transactions/${transactionId}`)).status()).toBe(404);
  // Dans sa propre entreprise, la formule Starter n'inclut ni la banque ni les documents.
  const locked = await other.request.get(`/api/v1/companies/${otherCompanyId}/bank/transactions`);
  expect(locked.status()).toBe(403);
  expect((await locked.json()).error.code).toBe("PLAN_FEATURE_UNAVAILABLE");
  expect((await other.request.get(`/api/v1/companies/${otherCompanyId}/documents/${documentId}/content`)).status()).toBe(403);
  await other.goto("/app/banque");
  await expect(other.getByText("Le suivi bancaire fait partie de la formule Pro")).toBeVisible();
  await other.goto("/app/documents");
  await expect(other.getByText("La gestion documentaire fait partie de la formule Pro")).toBeVisible();
  await context.close();

  // Sans session, rien n'est servi ; une requête d'une autre origine est refusée.
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/v1/companies/${companyId}/documents/${documentId}/content`)).status()).toBe(401);
  await anonymous.close();
  const foreign = await page.request.post(`/api/v1/companies/${companyId}/documents`, { headers: { origin: "https://site-malveillant.example" }, multipart: { file: { name: "piece.pdf", mimeType: "application/pdf", buffer: PDF } } });
  expect(foreign.status()).toBe(403);
});
