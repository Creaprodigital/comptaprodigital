import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { MAIL_DIR } from "../../playwright.config";

export const PASSWORD = "Compta-Solide-2026!";

/** Adresse unique par exécution : les tests peuvent être rejoués sur la même base. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

/** Adresse IP de documentation, différente pour chaque test (limites de débit indépendantes). */
export function uniqueClientIp(): string {
  return `198.51.100.${1 + Math.floor(Math.random() * 250)}, 10.0.0.${1 + Math.floor(Math.random() * 250)}`;
}

type CapturedMail = { to: string; subject: string; text: string };

/** Attend l'e-mail le plus récent adressé à `to` dont l'objet contient `subject`. */
export async function waitForMail(to: string, subject: string): Promise<CapturedMail> {
  let found: CapturedMail | undefined;
  await expect
    .poll(
      async () => {
        const files = (await readdir(MAIL_DIR)).sort().reverse();
        for (const file of files) {
          const mail = JSON.parse(await readFile(path.join(MAIL_DIR, file), "utf8")) as CapturedMail;
          if (mail.to.includes(to) && mail.subject.includes(subject)) {
            found = mail;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000, message: `e-mail « ${subject} » pour ${to}` },
    )
    .toBe(true);
  return found!;
}

export function linkFromMail(mail: CapturedMail, pathFragment: string): string {
  const match = new RegExp(`https?://[^\\s]*${pathFragment}[^\\s]*`).exec(mail.text);
  if (!match) throw new Error(`Aucun lien « ${pathFragment} » dans l'e-mail`);
  const url = new URL(match[0]);
  return `${url.pathname}${url.search}`;
}

/** Crée un compte vérifié par l'API (inscription, e-mail, confirmation) et ouvre une session. */
export async function createAccountViaApi(request: APIRequestContext, email: string, plan = "PRO") {
  const register = await request.post("/api/v1/auth/register", {
    data: { firstName: "Test", lastName: "E2E", email, password: PASSWORD, plan, acceptTerms: true },
  });
  expect(register.status()).toBe(201);
  const link = linkFromMail(await waitForMail(email, "Confirmez votre adresse e-mail"), "/verification-email");
  const token = new URLSearchParams(link.split("?")[1]).get("token");
  expect((await request.post("/api/v1/auth/verify-email", { data: { token } })).ok()).toBe(true);
  const login = await request.post("/api/v1/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBe(true);
}

export async function createCompanyViaApi(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/v1/companies", {
    data: { name, legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_SIMPLIFIE", vatExigibility: "ENCAISSEMENTS", fiscalYearStartMonth: 1 },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.id as string;
}

export async function loginThroughUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}
