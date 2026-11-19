import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import * as OTPAuth from "otpauth";
import { E2E_DATABASE_URL } from "../../playwright.config";
import { createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail, waitForMail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
test.afterAll(async () => prisma.$disconnect());

test("administration : accès réservé, support, accès justifié notifié, annonces et audit", async ({ page, playwright, baseURL }) => {
  // Client : une entreprise et une demande de support.
  const owner = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
  const ownerEmail = uniqueEmail("client-admin");
  await createAccountViaApi(owner, ownerEmail, "PRO");
  const companyId = await createCompanyViaApi(owner, "Boulangerie Surveillée");
  const run = Date.now().toString(36);
  const subject = `Écart de TVA sur mars ${run}`;
  const announcement = `Maintenance programmée ${run}`;
  const ticket = await owner.post("/api/v1/me/support", { data: { subject, message: "Le montant de TVA collectée ne correspond pas à mes factures.", companyId } });
  expect(ticket.status()).toBe(201);
  const ticketRef = (await ticket.json()).data.reference as string;

  await test.step("l'administration n'existe pas pour un client", async () => {
    expect((await owner.get("/admin")).status()).toBe(404);
    expect((await owner.get("/api/v1/admin/metrics")).status()).toBe(404);
  });

  // Administrateur : double authentification activée, puis promotion en base (comme le fait le seed).
  const adminEmail = uniqueEmail("super-admin");
  await createAccountViaApi(page.request, adminEmail, "STARTER");
  await prisma.user.update({ where: { email: adminEmail }, data: { isSuperAdmin: true } });

  await test.step("la double authentification est exigée", async () => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app\/compte\?mfa=admin/);
    expect((await page.request.get("/api/v1/admin/metrics")).status()).toBe(403);
    const setup = await page.request.post("/api/v1/me/mfa/setup");
    const secret = (await setup.json()).data.secret as string;
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate();
    expect((await page.request.post("/api/v1/me/mfa/enable", { data: { code } })).ok()).toBe(true);
  });

  await test.step("vue d'ensemble", async () => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Vue d'ensemble" })).toBeVisible();
    await expect(page.getByText("MRR", { exact: true })).toBeVisible();
    await expect(page.getByText("Répartition par formule")).toBeVisible();
  });

  await test.step("réponse à une demande de support", async () => {
    await page.getByRole("navigation", { name: "Navigation de l'administration" }).getByRole("link", { name: "Support" }).click();
    await page.getByRole("link", { name: subject }).click();
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    await expect(page.getByText(`${ticketRef} · Test E2E`)).toBeVisible();
    await page.getByLabel("Votre réponse").fill("Nous avons identifié une facture enregistrée deux fois ; vous pouvez l'annuler par un avoir.");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("Réponse envoyée au demandeur.")).toBeVisible();
    await waitForMail(ownerEmail, `Réponse à votre demande ${ticketRef}`);
  });

  await test.step("accès justifié aux données financières, notifié et révocable par le titulaire", async () => {
    await page.goto(`/admin/entreprises/${companyId}`);
    await expect(page.getByRole("heading", { name: "Boulangerie Surveillée" })).toBeVisible();
    await expect(page.getByText("Dernières factures émises")).toHaveCount(0);
    await page.getByRole("button", { name: "Demander un accès justifié" }).click();
    await page.getByLabel("Justification").fill(`Instruction de la demande ${ticketRef} (écart de TVA)`);
    await page.getByRole("button", { name: "Ouvrir l'accès" }).click();
    await expect(page.getByText("Dernières factures émises")).toBeVisible();
    await waitForMail(ownerEmail, "Accès du support aux données de Boulangerie Surveillée");

    const grants = await owner.get(`/api/v1/companies/${companyId}/access-grants`);
    const [grant] = (await grants.json()).data as Array<{ id: string; active: boolean; views: number }>;
    // Chaque affichage de la synthèse est journalisé.
    expect(grant.active).toBe(true);
    expect(grant.views).toBeGreaterThanOrEqual(1);
    expect((await owner.delete(`/api/v1/companies/${companyId}/access-grants/${grant.id}`)).status()).toBe(204);

    await page.reload();
    await expect(page.getByRole("button", { name: "Demander un accès justifié" })).toBeVisible();
    expect((await page.request.get(`/api/v1/admin/companies/${companyId}/financial`)).status()).toBe(403);
  });

  await test.step("annonce affichée dans l'espace client", async () => {
    await page.goto("/admin/annonces");
    await page.getByRole("button", { name: "Nouvelle annonce" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Titre").fill(announcement);
    await dialog.getByLabel("Message").fill("Le service sera indisponible dimanche de 2 h à 3 h.");
    await dialog.getByLabel("Niveau").selectOption("WARNING");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Annonce enregistrée.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: announcement }).getByText("En ligne")).toBeVisible();

    const app = await owner.get("/app/tableau-de-bord");
    expect(await app.text()).toContain(announcement);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: `Supprimer « ${announcement} »` }).click();
    await expect(page.getByText("Annonce supprimée.")).toBeVisible();
  });

  await test.step("journal d'audit et export", async () => {
    await page.goto("/admin/audit?action=admin.data_access");
    await expect(page.getByText("admin.data_access_granted").first()).toBeVisible();
    await expect(page.getByText("admin.data_access_revoked").first()).toBeVisible();
    const csv = await page.request.get("/api/v1/admin/audit?action=admin.&format=csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("admin.financial_data_view");
  });

  await test.step("intégrations contrôlées", async () => {
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: "Base de données" })).toBeVisible();
    await expect(page.getByText(/écriture, lecture et suppression/)).toBeVisible();
  });
  await owner.dispose();
});
