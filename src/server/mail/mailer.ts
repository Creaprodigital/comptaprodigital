import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/server/env";

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  cc?: string;
  attachments?: MailAttachment[];
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
    // Les pièces jointes ne sont pas recopiées : seuls leur nom et leur taille sont conservés.
    const summary = { ...message, attachments: message.attachments?.map((a) => ({ filename: a.filename, size: a.content.length })) };
    await writeFile(file, JSON.stringify(summary, null, 2), "utf8");
  }
  if (env().NODE_ENV === "development") {
    console.info(`\n[mail] À : ${message.to}\n[mail] Objet : ${message.subject}\n${message.text}\n`);
  }
}
