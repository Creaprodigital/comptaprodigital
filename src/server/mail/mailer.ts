import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/server/env";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

let transporter: Transporter | undefined;

function getTransporter(): Transporter | null {
  const config = env();
  if (!config.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

/** Boîte d'envoi en mémoire, alimentée hors production lorsque SMTP n'est pas configuré (tests). */
const memoryOutbox: MailMessage[] = [];

export function getMemoryOutbox(): MailMessage[] {
  return memoryOutbox;
}

export function clearMemoryOutbox() {
  memoryOutbox.length = 0;
}

/**
 * Envoi d'un e-mail transactionnel.
 *  - SMTP configuré : envoi réel.
 *  - Sinon, hors production : le message est affiché dans la console, conservé
 *    en mémoire et, si MAIL_CAPTURE_DIR est défini, écrit dans ce dossier.
 *  - En production, SMTP est obligatoire (voir env.ts).
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const transport = getTransporter();
  if (transport) {
    await transport.sendMail({ from: env().MAIL_FROM, ...message });
    return;
  }
  if (env().NODE_ENV === "production") {
    throw new Error("SMTP non configuré : impossible d'envoyer un e-mail en production.");
  }
  memoryOutbox.push(message);
  const captureDir = process.env.MAIL_CAPTURE_DIR;
  if (captureDir) {
    await mkdir(captureDir, { recursive: true });
    const file = path.join(captureDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await writeFile(file, JSON.stringify(message, null, 2), "utf8");
  }
  if (env().NODE_ENV === "development") {
    console.info(`\n[mail] À : ${message.to}\n[mail] Objet : ${message.subject}\n${message.text}\n`);
  }
}
