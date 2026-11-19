import { prisma } from "../src/server/db";
import { rotateEncryption } from "../src/server/security/rotation";

/**
 * Rotation de la clé de chiffrement (voir docs/SECURITE.md, « Rotation de la clé ») :
 *   APP_ENCRYPTION_KEY=<nouvelle> APP_ENCRYPTION_KEY_PREVIOUS=<ancienne> npm run keys:rotate
 * Relançable sans risque ; à exécuter après une sauvegarde.
 */
async function main() {
  const report = await rotateEncryption();
  console.log(`Secrets : ${report.secrets.rotated} rechiffré(s) sur ${report.secrets.examined}`);
  console.log(`Documents : ${report.documents.rotated} rechiffré(s) sur ${report.documents.examined}, ${report.documents.missing} absent(s) du stockage`);
  for (const error of report.errors) console.error(`Erreur : ${error}`);
  if (report.errors.length) process.exitCode = 1;
  else console.log("Rotation terminée : APP_ENCRYPTION_KEY_PREVIOUS peut être retirée.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
