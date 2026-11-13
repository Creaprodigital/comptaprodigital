import { expect, test } from "@playwright/test";
import { createAccountViaApi, createCompanyViaApi, linkFromMail, uniqueClientIp, uniqueEmail, waitForMail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test("invitation d'un collaborateur en lecture seule : acceptation et droits restreints", async ({ page, playwright, baseURL, browser }) => {
  const owner = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
  await createAccountViaApi(owner, uniqueEmail("proprietaire"), "BUSINESS");
  const companyId = await createCompanyViaApi(owner, "Société Invitante");

  const guestEmail = uniqueEmail("invite");
  const invitation = await owner.post(`/api/v1/companies/${companyId}/invitations`, { data: { email: guestEmail, role: "READ_ONLY" } });
  expect(invitation.status()).toBe(201);
  const link = linkFromMail(await waitForMail(guestEmail, "vous invite à rejoindre Société Invitante"), "/invitation/");

  await test.step("un visiteur non connecté est invité à s'identifier", async () => {
    const anonymous = await browser.newContext({ baseURL });
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(link);
    await expect(anonymousPage.getByRole("heading", { name: "Rejoindre Société Invitante" })).toBeVisible();
    await anonymousPage.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(anonymousPage.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", /\/connexion\?next=%2Finvitation%2F/);
    await anonymous.close();
  });

  await test.step("le destinataire accepte l'invitation et arrive sur le tableau de bord", async () => {
    await createAccountViaApi(page.request, guestEmail);
    await page.goto(link);
    await expect(page.getByText("Lecture seule")).toBeVisible();
    await page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(page).toHaveURL(/\/app\/tableau-de-bord/);
    await expect(page.getByText("Société Invitante ·")).toBeVisible();
  });

  await test.step("le rôle lecture seule ne peut ni modifier l'entreprise ni gérer l'équipe", async () => {
    await page.goto("/app/entreprise/parametres");
    await expect(page.getByText("permet de consulter ces informations, mais pas de les modifier")).toBeVisible();
    await expect(page.getByLabel("Raison sociale")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Enregistrer les modifications" })).toHaveCount(0);

    await page.goto("/app/entreprise/equipe");
    await expect(page.getByRole("heading", { name: "Membres (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inviter un membre" })).toHaveCount(0);

    // Les contrôles sont appliqués par l'API, pas seulement par l'interface.
    const patch = await page.request.patch(`/api/v1/companies/${companyId}`, {
      data: { name: "Renommée", legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_SIMPLIFIE" },
    });
    expect(patch.status()).toBe(403);
    const invite = await page.request.post(`/api/v1/companies/${companyId}/invitations`, { data: { email: uniqueEmail("x"), role: "COMPANY_ADMIN" } });
    expect(invite.status()).toBe(403);
    expect((await page.request.get(`/api/v1/companies/${companyId}/dashboard`)).status()).toBe(200);
  });

  await test.step("le lien d'invitation ne peut pas resservir", async () => {
    const reused = await owner.get(`/api/v1/invitations/${link.split("/invitation/")[1]}`);
    expect(reused.status()).toBe(404);
  });
  await owner.dispose();
});
