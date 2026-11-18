import { expect, test } from "@playwright/test";
import { createAccountViaApi, uniqueClientIp, uniqueEmail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

test("comptabilité : écritures générées, validation, saisie et contre-passation, états, achats, TVA et FEC", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await createAccountViaApi(page.request, uniqueEmail("compta"), "PRO");
  const company = await page.request.post("/api/v1/companies", {
    data: { name: "Atelier Compta E2E", siren: "552100554", legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_NORMAL_MENSUEL", vatExigibility: "DEBITS", fiscalYearStartMonth: 1 },
  });
  expect(company.status()).toBe(201);
  const companyId = (await company.json()).data.id as string;
  const api = `/api/v1/companies/${companyId}`;

  // Pièces : une facture émise, un compte bancaire et un encaissement.
  const customerId = (await (await page.request.post(`${api}/customers`, { data: { name: "Maison Verdier" } })).json()).data.id as string;
  const invoiceId = (await (await page.request.post(`${api}/invoices`, { data: { customerId, issueDate: day(3), operationCategory: "SERVICES", items: [{ description: "Conseil", quantity: "1", unitPriceExclTax: "1000", discountRate: "0", vatRate: "20" }] } })).json()).data.id as string;
  expect((await page.request.post(`${api}/invoices/${invoiceId}/issue`)).ok()).toBe(true);
  const accountId = (await (await page.request.post(`${api}/bank/accounts`, { data: { name: "Compte courant" } })).json()).data.id as string;
  expect((await page.request.post(`${api}/bank/transactions`, { data: { bankAccountId: accountId, date: day(1), label: "CB PAPETERIE", direction: "OUT", amount: "120" } })).ok()).toBe(true);

  await test.step("les écritures sont proposées au brouillard puis validées", async () => {
    await page.goto("/app/comptabilite");
    await expect(page.getByText("2 écritures à vérifier et valider")).toBeVisible();
    await page.goto("/app/comptabilite/ecritures?statut=DRAFT");
    await expect(page.getByRole("link", { name: /Facture F-\d{4}-0001 — Maison Verdier/ })).toBeVisible();
    await page.getByRole("link", { name: /Facture F-\d{4}-0001/ }).click();
    await expect(page.getByRole("heading", { name: "Écriture au brouillard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Facture/ }).last()).toBeVisible(); // lien vers la pièce d'origine
    await expect(page.getByText("706000").first()).toBeVisible();
    await page.goto("/app/comptabilite");
    await page.getByRole("button", { name: "Valider le brouillard" }).click();
    await expect(page.getByText("2 écritures validées.")).toBeVisible();
    await expect(page.getByText("Toutes les écritures sont validées.")).toBeVisible();
  });

  await test.step("une correction de la pièce produit une contre-passation, jamais une modification", async () => {
    const transactions = (await (await page.request.get(`${api}/bank/transactions`)).json()).data.items as Array<{ id: string }>;
    const categories = (await (await page.request.get(`${api}/bank/categories`)).json()).data as Array<{ id: string; name: string }>;
    const supplies = categories.find((c) => c.name === "Fournitures et petit équipement")!;
    expect((await page.request.patch(`${api}/bank/transactions/${transactions[0].id}`, { data: { categoryId: supplies.id, vatRate: "20" } })).ok()).toBe(true);
    await page.goto("/app/comptabilite/ecritures?statut=DRAFT");
    await expect(page.getByRole("link", { name: /Contre-passation de l'écriture n° 2/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "CB PAPETERIE", exact: true })).toBeVisible();
  });

  await test.step("saisie d'une écriture d'opérations diverses équilibrée, validation et contre-passation", async () => {
    await page.goto("/app/comptabilite/ecritures/nouvelle");
    await page.getByLabel("Libellé", { exact: true }).fill("Apport en compte courant");
    await page.getByLabel("Compte, ligne 1").fill("512000");
    await page.getByLabel("Débit, ligne 1").fill("500");
    await page.getByLabel("Compte, ligne 2").fill("455000");
    await page.getByLabel("Crédit, ligne 2").fill("450");
    await expect(page.getByText(/Écart de 50,00/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer au brouillard" })).toBeDisabled();
    await page.getByLabel("Crédit, ligne 2").fill("500");
    await expect(page.getByText("Écriture équilibrée")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer au brouillard" }).click();
    await expect(page.getByRole("heading", { name: "Écriture au brouillard" })).toBeVisible();
    await page.getByRole("button", { name: "Valider", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Écriture n° \d+/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Modifier" })).toHaveCount(0);
    await page.getByRole("button", { name: "Contre-passer" }).click();
    await page.getByRole("button", { name: "Préparer la contre-passation" }).click();
    await expect(page.getByText(/Contre-passation de l'écriture n° \d+\./)).toBeVisible();
  });

  await test.step("balance équilibrée et grand livre", async () => {
    await page.goto("/app/comptabilite/balance");
    await expect(page.getByRole("link", { name: "706000" })).toBeVisible();
    await expect(page.getByText("La balance n'est pas équilibrée")).toHaveCount(0);
    await page.goto("/app/comptabilite/grand-livre?compte=411");
    await expect(page.getByText("411000 — Clients")).toBeVisible();
  });

  await test.step("facture d'achat saisie dans les achats et comptabilisée au journal des achats", async () => {
    await page.goto("/app/achats");
    await page.getByRole("button", { name: "Nouvelle facture d'achat" }).first().click();
    await page.getByRole("textbox", { name: /^Objet/ }).fill("Licence logicielle");
    await page.getByLabel("Catégorie (compte de charge)").selectOption({ label: "Logiciels et abonnements" });
    await page.getByLabel("Nature").selectOption("GOODS");
    await page.getByLabel("Montant HT").fill("100");
    await page.getByRole("button", { name: "20 %" }).click();
    await expect(page.getByText("120,00 €")).toBeVisible();
    await page.getByRole("button", { name: "Ajouter la facture" }).click();
    await expect(page.getByRole("heading", { name: "Licence logicielle" })).toBeVisible();
    const entries = (await (await page.request.get(`${api}/accounting/entries?source=PURCHASE`)).json()).data.items as Array<{ journal: { code: string }; lines: Array<{ accountNumber: string }> }>;
    expect(entries[0].journal.code).toBe("AC");
    expect(entries[0].lines.map((l) => l.accountNumber).sort()).toEqual(["401000", "445660", "615600"]);
  });

  await test.step("TVA : période en cours simulée, rien n'est transmis", async () => {
    await page.goto("/app/tva");
    await expect(page.getByText("Réel normal, déclaration mensuelle (CA3)")).toBeVisible();
    await expect(page.getByText("Préparation, pas télétransmission")).toBeVisible();
    const simulation = (await (await page.request.get(`${api}/vat/simulation`)).json()).data;
    expect(simulation.current).toBeTruthy();
  });

  await test.step("FEC : seules les écritures validées, au format attendu", async () => {
    const years = (await (await page.request.get(`${api}/accounting/fiscal-years`)).json()).data as Array<{ id: string; endDate: string }>;
    const response = await page.request.get(`${api}/accounting/fec?fiscalYearId=${years[0].id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain(`552100554FEC${years[0].endDate.replace(/-/g, "")}.txt`);
    const lines = (await response.body()).toString("latin1").trim().split("\r\n");
    expect(lines[0].split("\t")).toHaveLength(18);
    expect(lines[0]).toBe("JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise");
    expect(lines.some((l) => l.includes("\t706000\tPrestations de services\t"))).toBe(true);
  });
});

test("comptabilité : micro-entreprise au livre des recettes, cloisonnement", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await createAccountViaApi(page.request, uniqueEmail("micro"), "STARTER");
  const company = await page.request.post("/api/v1/companies", { data: { name: "Micro E2E", legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE", fiscalYearStartMonth: 1 } });
  const companyId = (await company.json()).data.id as string;

  await page.goto("/app/comptabilite");
  await expect(page.getByRole("heading", { name: "Livre des recettes" })).toBeVisible();
  expect((await page.request.get(`/api/v1/companies/${companyId}/accounting/entries`)).status()).toBe(400);
  await page.goto("/app/tva");
  await expect(page.getByText("Le suivi de la TVA fait partie de la formule Pro")).toBeVisible();

  // Un autre compte ne voit rien de cette entreprise.
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
  const other = await context.newPage();
  await createAccountViaApi(other.request, uniqueEmail("intrus"), "PRO");
  for (const path of ["/accounting/cash-book?year=2026", "/accounting/entries", "/purchases", "/vat/periods"]) {
    expect((await other.request.get(`/api/v1/companies/${companyId}${path}`)).status(), path).toBe(404);
  }
  await context.close();
});
