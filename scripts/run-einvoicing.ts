import "dotenv/config";
import { prisma } from "../src/server/db";
import { einvoicingAvailable, processEInvoiceQueue, syncEInvoicing } from "../src/server/modules/einvoicing/service";

/**
 * Facturation électronique : file de dépôt (nouvelles tentatives) et récupération des statuts et des
 * factures reçues. À planifier toutes les 15 minutes lorsqu'une plateforme agréée est raccordée :
 *   npm run jobs:einvoicing
 * Sans plateforme, la tâche ne fait rien.
 */
async function main() {
  if (!einvoicingAvailable()) {
    console.log("Facturation électronique : aucune plateforme raccordée.");
    return;
  }
  const queue = await processEInvoiceQueue();
  const sync = await syncEInvoicing();
  console.log(`Dépôts : ${queue.sent} envoyé(s), ${queue.retried} à retenter, ${queue.failed} abandonné(s) ; statuts : ${sync.statuses} ; factures reçues : ${sync.received} (${sync.ignored} ignorée(s))`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
