import { expect, test } from "@playwright/test";
import { uniqueClientIp, uniqueEmail, waitForMail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test.describe("site vitrine", () => {
  test("la page d'accueil présente le produit et mène à l'inscription", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ComptaPro Digital/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Votre comptabilité avance");
    await expect(page.getByRole("figure", { name: /Aperçu du tableau de bord/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opérationnel en trois étapes" })).toBeVisible();

    await page.getByRole("link", { name: "Essayer gratuitement" }).first().click();
    await expect(page).toHaveURL(/\/inscription/);
    await expect(page.getByRole("heading", { name: "Créer votre compte" })).toBeVisible();
  });

  test("les tarifs proviennent de la base et basculent en annuel", async ({ page }) => {
    await page.goto("/tarifs");
    const pro = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });
    await expect(pro).toContainText("29 €");
    await expect(page.getByRole("article")).toHaveCount(3);

    await page.getByRole("button", { name: "Annuel" }).click();
    await expect(pro).toContainText("290 €");
    await expect(pro).toContainText("17 % d'économie");

    await pro.getByRole("link", { name: "Essayer gratuitement" }).click();
    await expect(page).toHaveURL(/\/inscription\?plan=pro/);
    await expect(page.getByLabel("Formule à l'essai")).toHaveValue("PRO");
  });

  test("toutes les pages du site répondent et portent un titre unique", async ({ page }) => {
    const paths = [
      "/fonctionnalites", "/facturation", "/comptabilite", "/synchronisation-bancaire", "/gestion-tva", "/solutions",
      "/solutions/micro-entrepreneur", "/faq", "/blog", "/blog/mentions-obligatoires-facture", "/contact",
      "/mentions-legales", "/cgu-cgv", "/confidentialite", "/connexion", "/mot-de-passe-oublie",
    ];
    const titles = new Set<string>();
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
      titles.add(await page.title());
    }
    expect(titles.size).toBe(paths.length);
  });

  test("la FAQ se déplie et une page inconnue renvoie une 404", async ({ page }) => {
    await page.goto("/faq");
    const question = page.getByRole("button", { name: "ComptaPro Digital remplace-t-il un expert-comptable ?" });
    await question.click();
    await expect(page.getByText("Il ne fournit pas de prestation d'expertise comptable", { exact: false })).toBeVisible();

    const response = await page.goto("/page-qui-n-existe-pas");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  });

  test("le formulaire de contact valide la saisie, enregistre la demande et accuse réception", async ({ page }) => {
    const email = uniqueEmail("contact");
    await page.goto("/contact");
    await page.getByRole("button", { name: "Envoyer le message" }).click();
    await expect(page.getByText("Votre nom est requis")).toBeVisible();

    await page.getByLabel("Nom").fill("Ada Martin");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Objet").fill("Question sur la formule Pro");
    await page.getByLabel("Message").fill("Bonjour, la formule Pro convient-elle à une SASU avec un salarié ?");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Envoyer le message" }).click();

    await expect(page.getByText("Message envoyé")).toBeVisible();
    const reference = (await page.getByText(/CT-[A-Z0-9]{8}/).first().textContent())!.match(/CT-[A-Z0-9]{8}/)![0];
    expect((await waitForMail(email, reference)).text).toContain(reference);
    expect((await waitForMail("support@e2e.test", reference)).text).toContain("SASU");
  });
});
