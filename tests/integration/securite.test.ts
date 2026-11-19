import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { LocalStorage, getDecrypted, setStorageForTests, storage } from "@/server/storage";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";
import { rotateEncryption } from "@/server/security/rotation";
import { scanBuffer } from "@/server/security/antivirus";
import { uploadDocument } from "@/server/modules/documents/service";
import { createBankAccount } from "@/server/modules/bank/accounts";
import { bankAccountSchema } from "@/lib/schemas/bank";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
const EICAR_MARK = "EICAR-TEST-SIGNATURE";
const saved = { ...process.env };
const OLD_KEY = Buffer.alloc(32, 1).toString("base64");
const NEW_KEY = Buffer.alloc(32, 2).toString("base64");

function setKeys(current: string, previous?: string) {
  process.env.APP_ENCRYPTION_KEY = current;
  if (previous) process.env.APP_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.APP_ENCRYPTION_KEY_PREVIOUS;
  resetEnvCache();
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

/** Faux démon clamd : protocole INSTREAM, signale les fichiers contenant le marqueur de test. */
function fakeClamd(): Promise<{ server: Server; port: number; scanned: () => number }> {
  let count = 0;
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = "zINSTREAM\0";
      if (buffer.length < command.length) return;
      let offset = command.length;
      const parts: Buffer[] = [];
      while (buffer.length >= offset + 4) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          count++;
          const content = Buffer.concat(parts).toString("latin1");
          socket.end(content.includes(EICAR_MARK) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (buffer.length < offset + 4 + size) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, scanned: () => count })));
}

let access: CompanyAccess;
let userId: string;
let storageDir: string;

beforeAll(async () => {
  await resetDatabase();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "cpd-securite-"));
  setStorageForTests(new LocalStorage(storageDir));
  const user = await createVerifiedUser({ email: "securite@exemple.test", plan: "PRO" });
  userId = user.id;
  access = await authorizeCompany(userId, (await createTestCompany(userId, "Coffre-Fort SAS")).id, "company:read");
});

afterAll(async () => {
  for (const key of ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY_PREVIOUS", "CLAMAV_HOST", "CLAMAV_PORT"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  setStorageForTests(undefined);
  await rm(storageDir, { recursive: true, force: true });
});

describe("rotation de la clé de chiffrement", () => {
  it("garde les données lisibles pendant la rotation puis les rechiffre avec la nouvelle clé", async () => {
    setKeys(OLD_KEY);
    await prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: encryptSecret("JBSWY3DPEHPK3PXP") } });
    const account = await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte", iban: "FR76 3000 6000 0112 3456 7890 189" }));
    const { document } = await uploadDocument(access, userId, { fileName: "facture.pdf", bytes: PDF });
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    const oldPayload = await storage().get(stored.storageKey);

    // Nouvelle clé sans l'ancienne : rien n'est lisible.
    setKeys(NEW_KEY);
    const secret = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mfaSecretEncrypted!;
    expect(() => decryptSecret(secret)).toThrow();
    await expect(getDecrypted(stored.storageKey)).rejects.toThrow();

    // Pendant la rotation, l'ancienne clé reste acceptée en lecture.
    setKeys(NEW_KEY, OLD_KEY);
    expect(decryptSecret(secret)).toBe("JBSWY3DPEHPK3PXP");
    expect((await getDecrypted(stored.storageKey))!.equals(PDF)).toBe(true);

    const report = await rotateEncryption();
    expect(report).toMatchObject({ secrets: { rotated: 2 }, documents: { rotated: 1, missing: 0 }, errors: [] });
    expect((await storage().get(stored.storageKey))!.equals(oldPayload!)).toBe(false);
    // Rejouable : plus rien à faire.
    expect((await rotateEncryption()).secrets.rotated + (await rotateEncryption()).documents.rotated).toBe(0);

    // Après retrait de l'ancienne clé, tout reste lisible.
    setKeys(NEW_KEY);
    expect(decryptSecret((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mfaSecretEncrypted!)).toBe("JBSWY3DPEHPK3PXP");
    const iban = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).ibanEncrypted!;
    expect(decryptSecret(iban).replace(/\s/g, "")).toBe("FR7630006000011234567890189");
    expect((await getDecrypted(stored.storageKey))!.equals(PDF)).toBe(true);
  });

  it("refuse de tourner sans ancienne clé", async () => {
    setKeys(NEW_KEY);
    await expect(rotateEncryption()).rejects.toThrow(/APP_ENCRYPTION_KEY_PREVIOUS/);
  });
});

describe("antivirus", () => {
  it("analyse les dépôts, refuse un fichier infecté et refuse tout dépôt si l'antivirus est injoignable", async () => {
    setKeys(NEW_KEY);
    expect(await scanBuffer(PDF)).toEqual({ status: "skipped" });

    const clamd = await fakeClamd();
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(clamd.port);
    resetEnvCache();
    // Fichier sain de plus de 64 Ko : envoyé en plusieurs morceaux.
    const big = Buffer.concat([PDF, Buffer.alloc(200_000, 32)]);
    expect(await scanBuffer(big)).toEqual({ status: "clean" });

    const infected = Buffer.concat([PDF, Buffer.from(`% ${EICAR_MARK}`)]);
    await expectAppError(uploadDocument(access, userId, { fileName: "piege.pdf", bytes: infected }), "FILE_INFECTED");
    expect(await prisma.document.count({ where: { companyId: access.company.id, originalFileName: "piege.pdf" } })).toBe(0);

    const { document } = await uploadDocument(access, userId, { fileName: "saine.pdf", bytes: Buffer.concat([PDF, Buffer.from("% saine")]) });
    expect(document.originalFileName).toBe("saine.pdf");
    expect(clamd.scanned()).toBe(3);

    await new Promise<void>((resolve) => clamd.server.close(() => resolve()));
    await expectAppError(uploadDocument(access, userId, { fileName: "autre.pdf", bytes: Buffer.concat([PDF, Buffer.from("% autre")]) }), "ANTIVIRUS_UNAVAILABLE");
    delete process.env.CLAMAV_HOST;
    resetEnvCache();
  });
});
