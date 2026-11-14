import "dotenv/config";
import { prisma } from "../src/server/db";
import { purgeStaleSessions } from "../src/server/auth/session-store";
import { purgeExpiredRateLimits } from "../src/server/security/rate-limit";
import { runRecurringInvoices } from "../src/server/modules/invoicing/recurring";
import { runAutomaticReminders } from "../src/server/modules/invoicing/sending";

/**
 * Tâches quotidiennes : factures récurrentes, relances automatiques, purges.
 * À planifier une fois par jour (cron) — voir docs/DEPLOIEMENT-HOSTINGER.md.
 *   npm run jobs:daily
 */
async function main() {
  const startedAt = Date.now();
  const recurring = await runRecurringInvoices();
  console.log(`Factures récurrentes : ${recurring.generated} générée(s), ${recurring.issued} émise(s), ${recurring.sent} envoyée(s), ${recurring.errors} erreur(s)`);
  const reminders = await runAutomaticReminders();
  console.log(`Relances : ${reminders.sent} envoyée(s), ${reminders.skipped} en attente, ${reminders.errors} erreur(s)`);
  const sessions = await purgeStaleSessions();
  const counters = await purgeExpiredRateLimits();
  console.log(`Purges : ${sessions} session(s), ${counters} compteur(s) de débit`);
  console.log(`Terminé en ${Date.now() - startedAt} ms`);
  if (recurring.errors + reminders.errors > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
