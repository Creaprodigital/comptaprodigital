import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { integrationsStatus } from "@/server/modules/admin/integrations";
import { getSetting } from "@/server/modules/admin/settings";
import { scanBuffer } from "@/server/security/antivirus";

/**
 * Vérification d'une installation de production, avant et après un déploiement :
 * configuration, base et migrations, services externes, comptes d'administration.
 * Chaque point est « ok », « warning » (à traiter, non bloquant) ou « error » (bloquant).
 */

export type CheckLevel = "ok" | "warning" | "error";
export type CheckItem = { level: CheckLevel; label: string; detail: string };

function weakKey(base64: string): boolean {
  const bytes = Buffer.from(base64, "base64");
  return new Set(bytes).size < 8;
}

export async function productionCheck(options: { migrationsDir?: string } = {}): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const add = (level: CheckLevel, label: string, detail: string) => items.push({ level, label, detail });

  let config;
  try {
    config = env();
  } catch (error) {
    add("error", "Variables d'environnement", error instanceof Error ? error.message : String(error));
    return items;
  }
  add(config.NODE_ENV === "production" ? "ok" : "error", "Mode", config.NODE_ENV === "production" ? "production" : `NODE_ENV=${config.NODE_ENV} : les contrôles de production ne s'appliquent pas`);
  add(config.APP_URL.startsWith("https://") ? "ok" : "error", "Adresse publique", config.APP_URL.startsWith("https://") ? config.APP_URL : "APP_URL doit être en https://");
  add(weakKey(config.APP_ENCRYPTION_KEY) ? "error" : "ok", "Clé de chiffrement", weakKey(config.APP_ENCRYPTION_KEY) ? "APP_ENCRYPTION_KEY semble être une clé de test (octets répétés) : générez-la avec « openssl rand -base64 32 »" : "32 octets aléatoires");
  if (config.APP_ENCRYPTION_KEY_PREVIOUS) add("warning", "Rotation de clé", "APP_ENCRYPTION_KEY_PREVIOUS est définie : terminez la rotation (npm run keys:rotate) puis retirez-la");
  if (process.env.ANTHROPIC_BASE_URL) add("warning", "Assistant IA", "ANTHROPIC_BASE_URL est définie : les requêtes d'IA ne vont pas directement à l'API Anthropic");

  const status = await integrationsStatus();
  // Migrations : toutes celles du dépôt doivent être appliquées.
  if (options.migrationsDir) {
    const expected = (await readdir(options.migrationsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).length;
    add(status.database.migrations >= expected && status.database.ok ? "ok" : "error", "Base de données", `${status.database.detail} — ${status.database.migrations}/${expected} migration(s)`);
  } else {
    add(status.database.ok ? "ok" : "error", "Base de données", status.database.detail);
  }
  add(status.smtp.ok ? "ok" : "error", "E-mails (SMTP)", status.smtp.error ?? status.smtp.detail);
  add(status.storage.ok ? "ok" : "error", "Stockage des documents", status.storage.error ?? status.storage.detail);
  if (!status.stripe.configured) add("warning", "Stripe", "Non configuré : aucun abonnement n'est facturé");
  else {
    add(status.stripe.ok ? "ok" : "error", "Stripe", status.stripe.error ?? status.stripe.detail);
    if (status.stripe.mode === "test") add("warning", "Stripe", "Clé de test (sk_test_…) : aucun paiement réel");
    if (status.stripe.syncedPlans === 0) add("warning", "Stripe", "Aucune formule synchronisée : synchronisez-les depuis /admin/formules");
  }
  if (status.ai.configured) add(status.ai.ok ? "ok" : "error", "Assistant IA", status.ai.error ?? status.ai.detail);
  else add("ok", "Assistant IA", "Non configuré (fonctions masquées)");
  if (config.CLAMAV_HOST) {
    try {
      const scan = await scanBuffer(Buffer.from("%PDF-1.4 contrôle de production"));
      add(scan.status === "clean" ? "ok" : "error", "Antivirus", scan.status === "clean" ? `ClamAV ${config.CLAMAV_HOST}:${config.CLAMAV_PORT} opérationnel` : `Réponse inattendue : ${scan.status}`);
    } catch (error) {
      add("error", "Antivirus", `ClamAV injoignable : ${error instanceof Error ? error.message : error}`);
    }
  } else add("warning", "Antivirus", "Non configuré : les fichiers déposés ne sont pas analysés (CLAMAV_HOST)");

  const admins = await prisma.user.findMany({ where: { isSuperAdmin: true, status: "ACTIVE" }, select: { email: true, mfaEnabledAt: true } });
  if (admins.length === 0) add("warning", "Administration", "Aucun super administrateur (SEED_ADMIN_EMAIL)");
  else {
    const withoutMfa = admins.filter((a) => !a.mfaEnabledAt).length;
    add(withoutMfa ? "warning" : "ok", "Administration", withoutMfa ? `${withoutMfa} super administrateur(s) sans double authentification : ils ne peuvent pas accéder à l'administration` : `${admins.length} super administrateur(s), double authentification activée`);
  }
  if (!(await getSetting("support.email"))) add("warning", "Support", "Adresse du support non renseignée (/admin/parametres)");
  add(status.dailyJobs.ok ? "ok" : "warning", "Tâches quotidiennes", status.dailyJobs.detail);
  return items;
}

export const defaultMigrationsDir = () => path.join(process.cwd(), "prisma", "migrations");
