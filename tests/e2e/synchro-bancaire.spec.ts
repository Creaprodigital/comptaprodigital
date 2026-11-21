import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BRIDGE_WEBHOOK_SECRET } from "../../playwright.config";
import { createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test("synchronisation bancaire : connexion par Bridge Connect, opérations reprises, webhook signé, déconnexion", async ({ page }) => {
  test.setTimeout(120_000);
  await createAccountViaApi(page.request, uniqueEmail("bridge"), "PRO");
  await createCompanyViaApi(page.request, "Atelier Bridge E2E");

  await test.step("connexion : parcours chez Bridge puis retour vérifié", async () => {
    await page.goto("/app/banque/comptes");
    await expect(page.getByText("ComptaPro Digital ne voit ni ne conserve jamais vos identifiants bancaires")).toBeVisible();
    await page.getByRole("button", { name: "Connecter une banque" }).click();
    await page.waitForURL(/\/app\/banque\/comptes\?connexion=ok/);
    await expect(page.getByText("Banque connectée")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compte pro Bridge" })).toBeVisible();
    await expect(page.getByText("Synchronisé", { exact: true })).toBeVisible();
    // Le solde affiché est celui communiqué par la banque.
    await expect(page.getByText(/1\s500,00\s€/).first()).toBeVisible();
    await expect(page.getByText("À jour")).toBeVisible();
  });

  await test.step("les opérations reprises sont à traiter comme celles d'un relevé", async () => {
    await page.goto("/app/banque");
    await expect(page.getByText("Virement client Garnier")).toBeVisible();
    await expect(page.getByText("Abonnement coworking")).toBeVisible();
  });

  await test.step("un retour de parcours rejoué ou forgé est refusé", async () => {
    await page.goto("/api/v1/bank/bridge/callback?item_id=1&success=true&context=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await expect(page).toHaveURL(/connexion=invalide/);
    await expect(page.getByText("n'a pas pu être vérifié")).toBeVisible();
  });

  await test.step("webhooks : signature obligatoire", async () => {
    const payload = JSON.stringify({ content: { item_id: 1234567890, status: 0, user_uuid: "9a95b38f-f98b-417a-988b-9d0d584893e7" }, timestamp: 1611681789, type: "TEST_EVENT" });
    const forged = await page.request.post("/api/v1/bank/bridge/webhook", { data: payload, headers: { "content-type": "application/json", "BridgeApi-Signature": `v1=${"A".repeat(64)}` } });
    expect(forged.status()).toBe(400);
    const signature = createHmac("sha256", BRIDGE_WEBHOOK_SECRET).update(payload).digest("hex").toUpperCase();
    const genuine = await page.request.post("/api/v1/bank/bridge/webhook", { data: payload, headers: { "content-type": "application/json", "BridgeApi-Signature": `v1=${signature}` } });
    expect(genuine.status()).toBe(200);
  });

  await test.step("déconnexion : les comptes et opérations restent", async () => {
    await page.goto("/app/banque/comptes");
    await page.getByRole("button", { name: "Déconnecter" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Déconnecter" }).click();
    await expect(page.getByText("Aucune banque connectée.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compte pro Bridge" })).toBeVisible();
    await expect(page.getByText("Synchronisé", { exact: true })).toHaveCount(0);
  });
});
