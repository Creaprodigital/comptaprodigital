import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";
import { ANTHROPIC_PORT, MAIL_DIR, SMTP_PORT } from "../../playwright.config";
import { startAutoFake } from "../support/fake-anthropic-auto";

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

  return async () => {
    await anthropic.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
