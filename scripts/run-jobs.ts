import "dotenv/config";
import { runRetentionPurges } from "../src/server/modules/retention/service";
import { sendDailyAlerts } from "../src/server/ops/alerts";
import { prisma } from "../src/server/db";
import { purgeStaleSessions } from "../src/server/auth/session-store";
import { purgeExpiredRateLimits } from "../src/server/security/rate-limit";
import { runRecurringInvoices } from "../src/server/modules/invoicing/recurring";
import { runAutomaticReminders } from "../src/server/modules/invoicing/sending";
import { purgeDeletedDocuments } from "../src/server/modules/documents/service";
import { dailyAccountingSync } from "../src/server/modules/accounting/sync";
import { syncAllBankConnections } from "../src/server/modules/bank/connections";
import { runTrialJobs } from "../src/server/billing/service";

/**
 * Tâches quotidiennes : factures récurrentes, relances automatiques, contrôle des
 * écritures comptables automatiques, purges.
 * À planifier une fois par jour (cron) — voir docs/DEPLOIEMENT-HOSTINGER.md.
 *   npm run jobs:daily
 */
async function main() {
  const startedAt = Date.now();
  const recurring = await runRecurringInvoices();
  console.log(`Factures récurrentes : ${recurring.generated} générée(s), ${recurring.issued} émise(s), ${recurring.sent} envoyée(s), ${recurring.errors} erreur(s)`);
  const reminders = await runAutomaticReminders();
  console.log(`Relances : ${reminders.sent} envoyée(s), ${reminders.skipped} en attente, ${reminders.errors} erreur(s)`);
  const trials = await runTrialJobs();
  console.log(`Essais : ${trials.reminded} rappel(s) envoyé(s), ${trials.expired} essai(s) terminé(s)`);
  const bank = await syncAllBankConnections();
  console.log(`Synchronisation bancaire : ${bank.connections} connexion(s), ${bank.imported} opération(s) importée(s), ${bank.errors} erreur(s)`);
  // Filet de sécurité : recalcul des écritures automatiques (sans effet si tout est à jour).
  const companies = await prisma.company.findMany({ where: { status: "ACTIVE", accountingMode: "DOUBLE_ENTRY" }, select: { id: true, fiscalYearStartMonth: true, accountingMode: true } });
  let accountingChanges = 0;
  let fullSyncs = 0;
  let accountingErrors = 0;
  for (const company of companies) {
    try {
      const result = await dailyAccountingSync(company);
      accountingChanges += result.changed;
      if (result.mode === "full") fullSyncs++;
    } catch (error) {
      accountingErrors++;
      console.error(`Comptabilité ${company.id} :`, error);
    }
  }
  console.log(`Comptabilité : ${companies.length} entreprise(s) vérifiée(s) (${fullSyncs} passe(s) complète(s)), ${accountingChanges} écriture(s) mise(s) à jour, ${accountingErrors} erreur(s)`);
  const sessions = await purgeStaleSessions();
  const counters = await purgeExpiredRateLimits();
  const documents = await purgeDeletedDocuments();
  console.log(`Purges : ${sessions} session(s), ${counters} compteur(s) de débit, ${documents} document(s) supprimé(s) depuis plus de 30 jours`);
  const retention = await runRetentionPurges();
  console.log(`Conservation : ${Object.entries(retention).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const alerts = await sendDailyAlerts().catch((error) => {
    console.error("Alertes :", error);
    return { sent: 0, alerts: -1 };
  });
  console.log(alerts.alerts > 0 ? `Alertes : ${alerts.alerts} point(s) signalé(s) à ${alerts.sent} destinataire(s)` : "Alertes : rien à signaler");
  // Dernière exécution, affichée dans la supervision de l'administration.
  await prisma.applicationSetting.upsert({ where: { key: "jobs.daily.last_run" }, create: { key: "jobs.daily.last_run", value: { at: new Date().toISOString(), durationMs: Date.now() - startedAt }, description: "Dernière exécution des tâches quotidiennes" }, update: { value: { at: new Date().toISOString(), durationMs: Date.now() - startedAt } } });
  console.log(`Terminé en ${Date.now() - startedAt} ms`);
  if (recurring.errors + reminders.errors + accountingErrors > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
