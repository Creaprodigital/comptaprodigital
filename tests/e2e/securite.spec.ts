import { expect, test } from "@playwright/test";
import { PASSWORD, createAccountViaApi, createCompanyViaApi, uniqueClientIp, uniqueEmail } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });

test.describe("sécurité de l'API et des pages", () => {
  test("l'espace client et l'API exigent une session", async ({ page, request }) => {
    await page.goto("/app/tableau-de-bord?period=year");
    await expect(page).toHaveURL(/\/connexion\?next=%2Fapp%2Ftableau-de-bord%3Fperiod%3Dyear/);

    for (const path of ["/api/v1/me", "/api/v1/companies", "/api/v1/me/sessions", "/api/v1/me/export", "/api/v1/company-search?q=atelier"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });

  test("un cookie de session invalide ne donne accès à rien", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await context.addCookies([{ name: "cpd_session", value: "jeton-forge-de-toutes-pieces", url: test.info().project.use.baseURL! }]);
    const page = await context.newPage();
    await page.goto("/app/tableau-de-bord");
    await expect(page).toHaveURL(/\/connexion/);
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
    await context.close();
  });

  test("les requêtes mutatrices d'une autre origine sont refusées (CSRF)", async ({ request }) => {
    const forged = await request.post("/api/v1/auth/login", {
      headers: { Origin: "https://site-malveillant.example" },
      data: { email: "victime@e2e.test", password: PASSWORD },
    });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.code).toBe("CSRF_REJECTED");

    const formPost = await request.post("/api/v1/auth/login", {
      headers: { "Content-Type": "text/plain" },
      data: JSON.stringify({ email: "victime@e2e.test", password: PASSWORD }),
    });
    expect(formPost.status()).toBe(415);
  });

  test("les entrées invalides sont rejetées avec le détail par champ, sans fuite technique", async ({ request }) => {
    const response = await request.post("/api/v1/auth/register", {
      data: { firstName: "", lastName: "X", email: "pas-une-adresse", password: "court", acceptTerms: false },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["firstName", "email", "password", "acceptTerms"]));
    expect(JSON.stringify(body)).not.toMatch(/prisma|stack|node_modules/i);

    const badLogin = await request.post("/api/v1/auth/login", { data: { email: "inconnu@e2e.test", password: PASSWORD } });
    expect(badLogin.status()).toBe(401);
    expect((await badLogin.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  test("les en-têtes de sécurité et les attributs du cookie de session sont en place", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
    const home = await api.get("/");
    const headers = home.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"]).toBeUndefined();

    const email = uniqueEmail("cookie");
    await createAccountViaApi(api, email);
    const login = await api.post("/api/v1/auth/login", { data: { email, password: PASSWORD } });
    const setCookie = login.headers()["set-cookie"];
    expect(setCookie).toMatch(/cpd_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(login.headers()["cache-control"]).toContain("no-store");
    await api.dispose();
  });

  test("un utilisateur ne peut pas atteindre l'entreprise d'un autre compte", async ({ playwright, baseURL }) => {
    const alice = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
    const bob = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueClientIp() } });
    await createAccountViaApi(alice, uniqueEmail("alice"));
    await createAccountViaApi(bob, uniqueEmail("bob"));
    const aliceCompany = await createCompanyViaApi(alice, "Société d'Alice");
    const bobCompany = await createCompanyViaApi(bob, "Société de Bob");

    // Chacun accède à sa propre entreprise…
    expect((await alice.get(`/api/v1/companies/${aliceCompany}/dashboard`)).status()).toBe(200);
    expect((await bob.get(`/api/v1/companies/${bobCompany}/dashboard`)).status()).toBe(200);

    // …mais l'entreprise de l'autre est introuvable, en lecture comme en écriture.
    const attempts = [
      await bob.get(`/api/v1/companies/${aliceCompany}`),
      await bob.get(`/api/v1/companies/${aliceCompany}/dashboard`),
      await bob.get(`/api/v1/companies/${aliceCompany}/members`),
      await bob.patch(`/api/v1/companies/${aliceCompany}`, { data: { name: "Piratée", legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_SIMPLIFIE" } }),
      await bob.post(`/api/v1/companies/${aliceCompany}/invitations`, { data: { email: "complice@e2e.test", role: "COMPANY_ADMIN" } }),
      await bob.put("/api/v1/me/active-company", { data: { companyId: aliceCompany } }),
    ];
    for (const response of attempts) {
      expect(response.status(), response.url()).toBe(404);
    }
    const companies = (await bob.get("/api/v1/companies")).json();
    expect(((await companies).data as Array<{ name: string }>).map((c) => c.name)).toEqual(["Société de Bob"]);
    expect((await (await alice.get(`/api/v1/companies/${aliceCompany}`)).json()).data.company.name).toBe("Société d'Alice");

    // La formule Pro est limitée à une entreprise.
    const second = await alice.post("/api/v1/companies", { data: { name: "Deuxième", legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_SIMPLIFIE" } });
    expect(second.status()).toBe(403);
    expect((await second.json()).error.code).toBe("PLAN_LIMIT_REACHED");

    // Après déconnexion, la session n'est plus utilisable.
    expect((await alice.post("/api/v1/auth/logout")).status()).toBe(204);
    expect((await alice.get("/api/v1/me")).status()).toBe(401);
    await alice.dispose();
    await bob.dispose();
  });
});
