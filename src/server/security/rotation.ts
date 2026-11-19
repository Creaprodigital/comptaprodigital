import { prisma } from "@/server/db";
import { decryptFileWithKeyIndex, encryptFile, storage } from "@/server/storage";
import { decryptSecretWithKeyIndex, encryptSecret, encryptionKeys } from "@/server/security/crypto";

/**
 * Rotation de la clé de chiffrement : tout ce qui est encore chiffré avec la clé précédente
 * (APP_ENCRYPTION_KEY_PREVIOUS) est rechiffré avec la clé courante (APP_ENCRYPTION_KEY).
 * Idempotente et reprenable : une donnée déjà chiffrée avec la clé courante est laissée telle quelle.
 */

export type RotationReport = { secrets: { examined: number; rotated: number }; documents: { examined: number; rotated: number; missing: number }; errors: string[] };

export async function rotateEncryption(): Promise<RotationReport> {
  if (encryptionKeys().length < 2) throw new Error("APP_ENCRYPTION_KEY_PREVIOUS doit contenir l'ancienne clé pendant la rotation.");
  const report: RotationReport = { secrets: { examined: 0, rotated: 0 }, documents: { examined: 0, rotated: 0, missing: 0 }, errors: [] };

  const rotateSecret = (value: string | null, label: string): string | null => {
    if (!value) return null;
    report.secrets.examined++;
    try {
      const { plaintext, keyIndex } = decryptSecretWithKeyIndex(value);
      if (keyIndex === 0) return null;
      report.secrets.rotated++;
      return encryptSecret(plaintext);
    } catch {
      report.errors.push(`${label} : illisible avec les deux clés`);
      return null;
    }
  };

  for (const user of await prisma.user.findMany({ where: { mfaSecretEncrypted: { not: null } }, select: { id: true, mfaSecretEncrypted: true } })) {
    const next = rotateSecret(user.mfaSecretEncrypted, `Secret TOTP de l'utilisateur ${user.id}`);
    if (next) await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: next } });
  }
  for (const company of await prisma.company.findMany({ where: { ibanEncrypted: { not: null } }, select: { id: true, ibanEncrypted: true } })) {
    const next = rotateSecret(company.ibanEncrypted, `IBAN de l'entreprise ${company.id}`);
    if (next) await prisma.company.update({ where: { id: company.id }, data: { ibanEncrypted: next } });
  }
  for (const account of await prisma.bankAccount.findMany({ where: { ibanEncrypted: { not: null } }, select: { id: true, ibanEncrypted: true } })) {
    const next = rotateSecret(account.ibanEncrypted, `IBAN du compte bancaire ${account.id}`);
    if (next) await prisma.bankAccount.update({ where: { id: account.id }, data: { ibanEncrypted: next } });
  }

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.document.findMany({ select: { id: true, storageKey: true }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (batch.length === 0) break;
    cursor = batch.at(-1)!.id;
    for (const document of batch) {
      report.documents.examined++;
      const payload = await storage().get(document.storageKey);
      if (!payload) {
        report.documents.missing++;
        continue;
      }
      try {
        const { plaintext, keyIndex } = decryptFileWithKeyIndex(document.storageKey, payload);
        if (keyIndex === 0) continue;
        await storage().put(document.storageKey, encryptFile(document.storageKey, plaintext));
        report.documents.rotated++;
      } catch {
        report.errors.push(`Document ${document.id} : illisible avec les deux clés`);
      }
    }
  }
  return report;
}
