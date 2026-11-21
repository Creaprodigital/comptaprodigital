import "dotenv/config";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout : l'application est construite puis démarrée en mode
 * production sur le port 3100, avec une base MySQL dédiée (suffixe _e2e) et un
 * serveur SMTP local qui capture les e-mails (voir tests/e2e/global-setup.ts).
 */
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
export const SMTP_PORT = 2526;
/** Faux serveur de l'API Anthropic (tests de l'assistant IA sans appel réel). */
export const ANTHROPIC_PORT = 2527;
/** Faux serveur de l'API Bridge (synchronisation bancaire), avec simulation de la page Bridge Connect. */
export const BRIDGE_PORT = 2528;
export const BRIDGE_WEBHOOK_SECRET = "e2e-bridge-webhook-secret";
export const MAIL_DIR = path.join(__dirname, "test-results", "mails");

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?.*)?$/, "/$1_e2e$2");
if (!databaseUrl) throw new Error("DATABASE_URL (ou E2E_DATABASE_URL) est requis pour les tests de bout en bout");
/** Base dédiée aux tests de bout en bout (utilisée aussi pour préparer un super administrateur). */
export const E2E_DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run e2e:server",
    url: `${baseURL}/robots.txt`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: databaseUrl,
      STORAGE_DRIVER: "local",
      ANTHROPIC_API_KEY: "sk-ant-e2e",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${ANTHROPIC_PORT}`,
      STORAGE_LOCAL_DIR: ".storage-e2e",
      APP_URL: baseURL,
      NEXT_PUBLIC_SITE_URL: baseURL,
      APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 9).toString("base64"),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(SMTP_PORT),
      SMTP_SECURE: "false",
      MAIL_FROM: "ComptaPro Digital <no-reply@e2e.test>",
      CONTACT_EMAIL: "support@e2e.test",
      SEED_DEMO: "false",
      INSEE_API_KEY: "",
      BRIDGE_CLIENT_ID: "client_test",
      BRIDGE_CLIENT_SECRET: "secret_test",
      BRIDGE_WEBHOOK_SECRET,
      BRIDGE_API_BASE: `http://127.0.0.1:${BRIDGE_PORT}`,
    },
  },
});
