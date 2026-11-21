import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";
import { ANTHROPIC_PORT, BRIDGE_PORT, MAIL_DIR, SMTP_PORT } from "../../playwright.config";
import { startAutoFake } from "../support/fake-anthropic-auto";
import { FakeBridge } from "../support/fake-bridge";

/**
 * Serveur SMTP local : l'application envoie ses e-mails par SMTP comme en
 * production ; chaque message reçu est écrit en JSON pour être lu par les tests.
 */
export default async function globalSetup() {
  await rm(MAIL_DIR, { recursive: true, force: true });
  await mkdir(MAIL_DIR, { recursive: true });

  let counter = 0;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then(async (mail) => {
          const to = Array.isArray(mail.to) ? mail.to.map((a) => a.text).join(", ") : (mail.to?.text ?? "");
          const file = path.join(MAIL_DIR, `${Date.now()}-${String(++counter).padStart(4, "0")}.json`);
          const attachments = mail.attachments.map((a) => ({ filename: a.filename ?? "", contentType: a.contentType, size: a.size, isPdf: a.content.subarray(0, 5).toString() === "%PDF-" }));
          await writeFile(file, JSON.stringify({ to, subject: mail.subject ?? "", text: mail.text ?? "", attachments }), "utf8");
          callback();
        })
        .catch((error) => callback(error));
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve());
  });

  const anthropic = await startAutoFake(ANTHROPIC_PORT);

  // Banque de démonstration : chaque parcours Bridge Connect ajoute un compte courant et deux opérations.
  // Identifiants uniques d'une exécution à l'autre, comme chez Bridge.
  const bridge = new FakeBridge((Date.now() % 1_000_000) * 1000);
  bridge.onConnect = (userUuid, existing) => {
    if (existing) return existing;
    const item = bridge.addItem(userUuid);
    const account = bridge.addAccount(item.id, { name: "Compte pro Bridge", balance: 1500, iban: "FR7630004000031234567890143" });
    const today = new Date().toISOString().slice(0, 10);
    bridge.addTransaction(account.id, { amount: 1650, date: today, clean_description: "Virement client Garnier", provider_description: "VIR SEPA GARNIER" });
    bridge.addTransaction(account.id, { amount: -150, date: today, clean_description: "Abonnement coworking", provider_description: "PRLV SEPA COWORKING" });
    return item.id;
  };
  await bridge.start(BRIDGE_PORT);

  return async () => {
    await bridge.stop();
    await anthropic.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
