import { expect, test } from "@playwright/test";
import { createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail, waitForMail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test("facturation : client, article, facture émise, envoi, règlement, avoir et tableau de bord", async ({ page }) => {
  test.setTimeout(150_000);
  const ownerEmail = uniqueEmail("facturation");
  const customerEmail = uniqueEmail("client");
  await createAccountViaApi(page.request, ownerEmail, "BUSINESS");
  const companyId = await createCompanyViaApi(page.request, "Atelier Factures E2E");
  const year = new Date().getFullYear();

  await test.step("création d'un client", async () => {
    await page.goto("/app/clients");
    await expect(page.getByText("Aucun client pour l'instant")).toBeVisible();
    await page.getByRole("button", { name: "Nouveau client" }).first().click();
    await page.getByLabel("SIREN").fill("123456789");
    await page.getByRole("button", { name: "Créer le client" }).click();
    await expect(page.getByText("Le nom est requis")).toBeVisible();
    await expect(page.getByText("Numéro SIREN invalide")).toBeVisible();

    await page.getByLabel("Nom ou raison sociale").fill("Librairie des Arcades");
    await page.getByLabel("Adresse e-mail").fill(customerEmail);
    await page.getByLabel("SIREN").fill("732 829 320");
    await page.getByRole("button", { name: "Créer le client" }).click();
    await expect(page.getByRole("cell", { name: /Librairie des Arcades/ })).toBeVisible();
  });

  await test.step("création d'un article du catalogue", async () => {
    await page.goto("/app/catalogue");
    await page.getByRole("button", { name: "Nouvel article" }).first().click();
    await page.getByLabel("Désignation").fill("Journée de conseil");
    await page.getByLabel("Prix unitaire HT").fill("650");
    await page.getByLabel("Unité").fill("jour");
    await page.getByRole("button", { name: "Créer l'article" }).click();
    await expect(page.getByRole("cell", { name: /Journée de conseil/ })).toBeVisible();
  });

  await test.step("brouillon de facture avec totaux calculés en direct", async () => {
    await page.goto("/app/factures/nouvelle");
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await expect(page.getByText("Certaines informations sont invalides")).toBeVisible();

    await page.getByLabel("Client", { exact: true }).selectOption({ label: "Librairie des Arcades" });
    await page.getByLabel("Objet").fill("Mission de conseil");
    await page.getByLabel("Insérer un article du catalogue").selectOption({ label: "Journée de conseil" });
    await page.getByLabel("Quantité").fill("2");
    await page.getByRole("button", { name: "Ajouter une ligne" }).click();
    await page.getByLabel("Désignation").nth(1).fill("Frais de déplacement");
    await page.getByLabel("Prix unitaire HT").nth(1).fill("120,50");
    await page.getByLabel("TVA").nth(1).selectOption("10.00");
    // 2 × 650 = 1 300 (TVA 260) + 120,50 (TVA 12,05) → HT 1 420,50 ; TTC 1 692,55
    const totals = page.locator("[data-slot=card]").filter({ hasText: "Totaux" });
    await expect(totals).toContainText("1 420,50 €");
    await expect(totals).toContainText("1 692,55 €");

    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await expect(page).toHaveURL(/\/app\/factures\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Facture (brouillon)" })).toBeVisible();
    await expect(page.getByText("Ce document est un brouillon")).toBeVisible();
  });

  const invoiceId = page.url().split("/").pop()!;

  await test.step("émission : numéro définitif et verrouillage", async () => {
    await page.getByRole("button", { name: "Émettre la facture" }).click();
    await expect(page.getByText("toute correction passera par un avoir")).toBeVisible();
    await page.getByRole("button", { name: "Émettre définitivement" }).click();
    await expect(page.getByRole("heading", { name: `Facture F-${year}-0001` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Modifier" })).toHaveCount(0);

    // Une facture émise ne se modifie ni ne se supprime, même en appelant directement l'API.
    const patch = await page.request.patch(`/api/v1/companies/${companyId}/invoices/${invoiceId}`, {
      data: { customerId: "x", issueDate: `${year}-01-01`, items: [{ description: "Falsification", quantity: "1", unitPriceExclTax: "1", vatRate: "20" }] },
    });
    expect([409, 422]).toContain(patch.status());
    expect((await page.request.delete(`/api/v1/companies/${companyId}/invoices/${invoiceId}`)).status()).toBe(409);
    await page.goto(`/app/factures/${invoiceId}/modifier`);
    await expect(page).toHaveURL(new RegExp(`/app/factures/${invoiceId}$`));
  });

  await test.step("PDF et export CSV", async () => {
    const pdf = await page.request.get(`/api/v1/companies/${companyId}/invoices/${invoiceId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const csv = await page.request.get(`/api/v1/companies/${companyId}/invoices/export`);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain(`F-${year}-0001;Facture;Émise`);
  });

  await test.step("envoi par e-mail avec le PDF en pièce jointe", async () => {
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByLabel("Destinataire")).toHaveValue(customerEmail);
    await page.getByRole("dialog").getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("Facture envoyée par e-mail.")).toBeVisible();
    const mail = await waitForMail(customerEmail, `Facture F-${year}-0001`);
    expect(mail.text).toContain("1 692,55");
    expect(mail.attachments).toEqual([expect.objectContaining({ filename: `facture-f-${year}-0001.pdf`, contentType: "application/pdf", isPdf: true })]);
    await expect(page.getByText("Envoyée", { exact: true })).toBeVisible();
  });

  await test.step("règlement partiel puis avoir sur le solde", async () => {
    await page.getByRole("button", { name: "Enregistrer un règlement" }).click();
    await page.getByLabel("Montant").fill("5000");
    await page.getByRole("button", { name: "Enregistrer le règlement" }).click();
    await expect(page.getByText(/dépasse le reste à encaisser/)).toBeVisible();
    await page.getByLabel("Montant").fill("1000");
    await page.getByRole("button", { name: "Enregistrer le règlement" }).click();
    await expect(page.getByText("Payée partiellement")).toBeVisible();
    await expect(page.getByText("692,55 €").first()).toBeVisible();

    await page.getByRole("button", { name: "Créer un avoir" }).click();
    await page.getByLabel("Motif").fill("Geste commercial");
    await page.getByText("Avoir partiel").click();
    await page.getByLabel("Montant HT").fill("100");
    await page.getByRole("button", { name: "Préparer l'avoir" }).click();
    await expect(page.getByRole("heading", { name: "Avoir (brouillon)" })).toBeVisible();
    await page.getByRole("button", { name: "Émettre l'avoir" }).click();
    await page.getByRole("button", { name: "Émettre définitivement" }).click();
    await expect(page.getByRole("heading", { name: `Avoir A-${year}-0001` })).toBeVisible();

    await page.getByRole("link", { name: `F-${year}-0001` }).click();
    // 1 692,55 − 1 000 (règlement) − 120 (avoir de 100 HT à 20 %) = 572,55
    await expect(page.getByText("572,55 €").first()).toBeVisible();
  });

  await test.step("le tableau de bord reflète la facturation réelle", async () => {
    await page.goto("/app/tableau-de-bord");
    const card = (label: string) => page.locator("[data-slot=card]").filter({ has: page.getByText(label, { exact: true }) });
    await expect(card("Recettes")).toContainText("1 320,50 €"); // 1 420,50 − 100 d'avoir
    await expect(card("Factures impayées")).toContainText("572,55 €");
    await expect(card("Factures impayées")).toContainText("1 facture");
    await expect(page.getByText("Votre tableau de bord est prêt")).toHaveCount(0);
  });
});

test("devis : envoi, acompte puis facture finale ; droits et cloisonnement", async ({ page, playwright, baseURL }) => {
  test.setTimeout(120_000);
  await createAccountViaApi(page.request, uniqueEmail("devis"), "BUSINESS");
  const companyId = await createCompanyViaApi(page.request, "Atelier Devis E2E");
  const api = `/api/v1/companies/${companyId}`;
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const customer = await (await page.request.post(`${api}/customers`, { data: { name: "Studio Oréade", email: uniqueEmail("studio") } })).json();
  const customerId = customer.data.id as string;

  await test.step("création et envoi du devis", async () => {
    await page.goto("/app/devis/nouveau");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: "Studio Oréade" });
    await page.getByLabel("Objet").fill("Site vitrine");
    await page.getByLabel("Désignation").fill("Conception et développement");
    await page.getByLabel("Prix unitaire HT").fill("4000");
    await page.getByRole("button", { name: "Créer le devis" }).click();
    await expect(page.getByRole("heading", { name: `Devis D-${year}-0001` })).toBeVisible();
    await page.getByRole("button", { name: "Marquer comme envoyé" }).click();
    await expect(page.getByText("Envoyé", { exact: true })).toBeVisible();
  });

  await test.step("facture d'acompte de 30 %", async () => {
    await page.getByRole("button", { name: "Facturer" }).click();
    await page.getByText("Facture d'acompte", { exact: true }).click();
    await page.getByRole("button", { name: "Préparer la facture" }).click();
    await expect(page.getByRole("heading", { name: "Facture d'acompte (brouillon)" })).toBeVisible();
    await expect(page.getByText("1 440,00 €").first()).toBeVisible(); // 30 % de 4 800 TTC
    await page.getByRole("button", { name: "Émettre la facture" }).click();
    await page.getByRole("button", { name: "Émettre définitivement" }).click();
    await expect(page.getByRole("heading", { name: `Facture d'acompte F-${year}-0001` })).toBeVisible();
  });

  await test.step("facture finale : acompte déduit", async () => {
    await page.getByRole("link", { name: `D-${year}-0001` }).click();
    await expect(page.getByText("Accepté", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Facturer" }).click();
    await page.getByRole("button", { name: "Préparer la facture" }).click();
    await expect(page.getByRole("heading", { name: "Facture (brouillon)" })).toBeVisible();
    await expect(page.getByText(`Acompte déjà facturé — facture F-${year}-0001`)).toBeVisible();
    await expect(page.getByText("3 360,00 €").first()).toBeVisible(); // 4 800 − 1 440
  });

  await test.step("un lecteur consulte mais ne peut rien émettre ni modifier ; un autre compte ne voit rien", async () => {
    const readerEmail = uniqueEmail("lecteur");
    await page.request.post(`${api}/invitations`, { data: { email: readerEmail, role: "READ_ONLY" } });
    const reader = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
    await createAccountViaApi(reader, readerEmail);
    const invitation = await waitForMail(readerEmail, "vous invite à rejoindre");
    const token = /\/invitation\/([A-Za-z0-9_-]+)/.exec(invitation.text)![1];
    expect((await reader.post(`/api/v1/invitations/${token}/accept`)).status()).toBe(200);

    const invoices = (await (await reader.get(`${api}/invoices`)).json()).data.items as Array<{ id: string; status: string }>;
    expect(invoices).toHaveLength(2);
    const draft = invoices.find((i) => i.status === "DRAFT")!;
    const line = { description: "X", quantity: "1", unitPriceExclTax: "1", vatRate: "20" };
    for (const response of [
      await reader.post(`${api}/invoices/${draft.id}/issue`),
      await reader.post(`${api}/invoices`, { data: { customerId, issueDate: today, items: [line] } }),
      await reader.delete(`${api}/invoices/${draft.id}`),
      await reader.post(`${api}/invoices/${invoices.find((i) => i.status !== "DRAFT")!.id}/payments`, { data: { amount: "1", paidAt: today } }),
      await reader.post(`${api}/customers`, { data: { name: "Interdit" } }),
      await reader.patch(`${api}/billing-settings`, { data: { invoicePrefix: "X", quotePrefix: "D", creditNotePrefix: "A", defaultPaymentTermDays: 30, quoteValidityDays: 30 } }),
    ]) {
      expect(response.status(), response.url()).toBe(403);
    }
    expect((await reader.get(`${api}/invoices/${draft.id}/pdf`)).status()).toBe(200);

    const stranger = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
    await createAccountViaApi(stranger, uniqueEmail("etranger"));
    await createCompanyViaApi(stranger, "Société étrangère");
    for (const path of [`${api}/invoices`, `${api}/invoices/${draft.id}`, `${api}/invoices/${draft.id}/pdf`, `${api}/customers`, `${api}/quotes/export`, `${api}/logo`]) {
      expect((await stranger.get(path)).status(), path).toBe(404);
    }
    await reader.dispose();
    await stranger.dispose();
  });
});
