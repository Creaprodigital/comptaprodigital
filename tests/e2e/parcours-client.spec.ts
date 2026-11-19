import { expect, test } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { PASSWORD, linkFromMail, loginThroughUi, uniqueClientIp, uniqueEmail, waitForMail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test("parcours complet : inscription, vérification, entreprise, tableau de bord, double authentification", async ({ page }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("parcours");

  await test.step("inscription", async () => {
    await page.goto("/inscription?plan=business");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Le prénom est requis")).toBeVisible();
    await expect(page.getByText("Vous devez accepter les conditions générales")).toBeVisible();

    await page.getByLabel("Prénom").fill("Lina");
    await page.getByLabel("Nom", { exact: true }).fill("Durand");
    await page.getByLabel("Adresse e-mail professionnelle").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByRole("heading", { name: "Vérifiez votre boîte de réception" })).toBeVisible();
  });

  await test.step("connexion refusée avant confirmation de l'adresse", async () => {
    await loginThroughUi(page, email);
    await expect(page.getByText("Adresse e-mail à confirmer")).toBeVisible();
  });

  await test.step("confirmation par le lien reçu", async () => {
    const mail = await waitForMail(email, "Confirmez votre adresse e-mail");
    await page.goto(linkFromMail(mail, "/verification-email"));
    await expect(page.getByRole("heading", { name: "Adresse e-mail confirmée" })).toBeVisible();
  });

  await test.step("connexion et création de l'entreprise", async () => {
    await loginThroughUi(page, email);
    await expect(page).toHaveURL(/\/app\/entreprises/);
    await expect(page.getByRole("heading", { name: "Bienvenue ! Ajoutons votre entreprise" })).toBeVisible();

    await page.getByLabel("Raison sociale").fill("Atelier E2E");
    await page.getByLabel("SIREN", { exact: true }).fill("123456789");
    await page.getByRole("button", { name: "Créer l'entreprise" }).click();
    await expect(page.getByText("Numéro SIREN invalide")).toBeVisible();

    await page.getByLabel("SIREN", { exact: true }).fill("552 100 554");
    await page.getByLabel("Forme juridique").selectOption("SAS");
    await page.getByLabel("Régime de TVA").selectOption("REEL_NORMAL_MENSUEL");
    await page.getByRole("button", { name: "Créer l'entreprise" }).click();
    await expect(page).toHaveURL(/\/app\/tableau-de-bord/);
  });

  await test.step("tableau de bord vide : des zéros, aucune donnée fictive", async () => {
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByText("Votre tableau de bord est prêt")).toBeVisible();
    await expect(page.getByText("Atelier E2E ·")).toBeVisible();
    for (const label of ["Recettes", "Dépenses", "Solde bancaire", "Factures impayées"]) {
      const card = page.locator("[data-slot=card]").filter({ has: page.getByText(label, { exact: true }) });
      await expect(card).toContainText("0,00 €");
    }
    await expect(page.getByText("Aucune opération bancaire enregistrée.")).toBeVisible();

    await page.getByRole("link", { name: "Année", exact: true }).click();
    await expect(page).toHaveURL(/period=year/);
    await expect(page.getByText(/Période analysée : du 01\/01\/\d{4} au 31\/12\/\d{4}/).first()).toBeVisible();
  });

  await test.step("paramètres : les informations saisies sont enregistrées", async () => {
    await page.getByRole("link", { name: "Paramètres" }).click();
    await expect(page.getByLabel("Raison sociale")).toHaveValue("Atelier E2E");
    await expect(page.getByLabel("SIREN", { exact: true })).toHaveValue("552100554");
    await expect(page.getByLabel("N° de TVA intracommunautaire")).toHaveValue("FR96552100554");

    await page.getByLabel("Ville").fill("Lyon");
    await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
    await expect(page.getByText("Informations de l'entreprise enregistrées.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Ville")).toHaveValue("Lyon");
  });

  let totp: OTPAuth.TOTP;
  let activationCode = "";
  await test.step("activation de la double authentification", async () => {
    await page.goto("/app/compte");
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    const secret = (await page.locator("code").textContent())!.trim();
    totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 });

    activationCode = totp.generate();
    await page.getByLabel("Code à 6 chiffres").fill(activationCode);
    await page.getByRole("button", { name: "Activer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Conservez vos codes de secours" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(10);
    await page.getByRole("button", { name: "J'ai noté mes codes" }).click();
    await expect(page.getByText("Activée", { exact: true })).toBeVisible();
  });

  await test.step("déconnexion puis reconnexion avec le second facteur", async () => {
    await page.getByRole("button", { name: "Menu du compte" }).click();
    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/connexion/);

    await page.goto("/app/tableau-de-bord");
    await expect(page).toHaveURL(/\/connexion\?next=/);

    await loginThroughUi(page, email);
    await expect(page.getByRole("heading", { name: "Vérification en deux étapes" })).toBeVisible();
    await page.getByLabel("Code de vérification").fill("000000");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Code de vérification incorrect.")).toBeVisible();

    // Anti-rejeu : le code qui a servi à activer la double authentification est refusé, avec un message clair.
    await page.getByLabel("Code de vérification").fill(activationCode);
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Ce code a déjà été utilisé")).toBeVisible();
    // Code suivant (accepté grâce à la tolérance d'un pas pour les décalages d'horloge).
    await page.getByLabel("Code de vérification").fill(totp.generate({ timestamp: Date.now() + 30_000 }));
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page).toHaveURL(/\/app\/tableau-de-bord/);
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });
});
