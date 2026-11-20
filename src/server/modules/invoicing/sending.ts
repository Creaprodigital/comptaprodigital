import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { getCompanyAccess, type CompanyAccess } from "@/server/rbac/service";
import { formatIsoForHumans, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";
import { INVOICE_TYPE_LABELS, remainingAmount } from "@/lib/invoicing";
import { buildQuoteDocument } from "@/server/modules/invoicing/document-model";
import { getInvoiceDetail, markInvoiceSent, type InvoiceWithDetail } from "@/server/modules/invoicing/invoices";
import { pdfFileName, renderDocumentPdf } from "@/server/modules/invoicing/pdf";
import { renderInvoicePdf } from "@/server/modules/invoicing/invoice-pdf";
import { getQuoteDetail, setQuoteStatus } from "@/server/modules/invoicing/quotes";
import type { Meta } from "@/server/modules/invoicing/shared";

type SendInput = { to: string; subject: string; message: string; copyToSelf?: boolean };
type Sender = { id: string; email: string; firstName: string; lastName: string } | null;

function euros(value: { toFixed(n: number): string }): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value.toFixed(2) as unknown as number);
}

/** Message proposé par défaut dans la fenêtre d'envoi (modifiable par l'utilisateur). */
export function defaultInvoiceMessage(companyName: string, invoice: InvoiceWithDetail): { subject: string; message: string } {
  const label = INVOICE_TYPE_LABELS[invoice.type].toLowerCase();
  const due = invoice.dueDate && invoice.type !== "CREDIT_NOTE" ? `\n\nElle est à régler avant le ${formatIsoForHumans(toIsoDate(invoice.dueDate))}.` : "";
  return {
    subject: `${INVOICE_TYPE_LABELS[invoice.type]} ${invoice.number} — ${companyName}`,
    message: `Bonjour,\n\nVeuillez trouver ci-joint notre ${label} ${invoice.number} d'un montant de ${euros(invoice.totalInclTax)} TTC.${due}\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${companyName}`,
  };
}

export function defaultQuoteMessage(companyName: string, quote: { number: string; totalInclTax: { toFixed(n: number): string }; validUntil: Date | null }): { subject: string; message: string } {
  const validity = quote.validUntil ? `\n\nCette proposition est valable jusqu'au ${formatIsoForHumans(toIsoDate(quote.validUntil))}.` : "";
  return {
    subject: `Devis ${quote.number} — ${companyName}`,
    message: `Bonjour,\n\nVeuillez trouver ci-joint notre devis ${quote.number} d'un montant de ${euros(quote.totalInclTax)} TTC.${validity}\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${companyName}`,
  };
}

/** Envoie une facture émise par e-mail, PDF joint, et la marque comme envoyée. */
export async function sendInvoiceByEmail(access: CompanyAccess, sender: Sender, invoiceId: string, input: SendInput, meta: Meta = {}): Promise<void> {
  const invoice = await getInvoiceDetail(access, invoiceId);
  if (invoice.status === "DRAFT") throw errors.badRequest("INVOICE_NOT_ISSUED", "Émettez la facture avant de l'envoyer.");

  const { pdf, fileName } = await renderInvoicePdf(access, invoice);
  await sendMail({
    ...mailTemplates.documentEmail({
      to: input.to,
      subject: input.subject,
      message: input.message,
      senderName: access.company.name,
      replyTo: access.company.email ?? sender?.email,
      cc: input.copyToSelf && sender ? sender.email : undefined,
    }),
    attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
  });
  await markInvoiceSent(access.company.id, invoice.id);
  await recordAudit({
    action: "invoice.sent",
    userId: sender?.id ?? null,
    companyId: access.company.id,
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { detail: `Envoyée par e-mail à ${input.to}`, to: input.to },
    ...meta,
  });
}

export async function sendQuoteByEmail(access: CompanyAccess, sender: Sender, quoteId: string, input: SendInput, meta: Meta = {}): Promise<void> {
  const quote = await getQuoteDetail(access, quoteId);
  const document = await buildQuoteDocument(access, { ...quote, status: quote.status === "DRAFT" ? "SENT" : quote.status });
  const pdf = await renderDocumentPdf(document);
  await sendMail({
    ...mailTemplates.documentEmail({
      to: input.to,
      subject: input.subject,
      message: input.message,
      senderName: access.company.name,
      replyTo: access.company.email ?? sender?.email,
      cc: input.copyToSelf && sender ? sender.email : undefined,
    }),
    attachments: [{ filename: pdfFileName(document), content: pdf, contentType: "application/pdf" }],
  });
  if (quote.status === "DRAFT") await setQuoteStatus(access, sender?.id ?? null, quote.id, "SENT", meta);
  await recordAudit({
    action: "quote.emailed",
    userId: sender?.id ?? null,
    companyId: access.company.id,
    entityType: "Quote",
    entityId: quote.id,
    metadata: { detail: `Envoyé par e-mail à ${input.to}`, to: input.to },
    ...meta,
  });
}

// --- Relances ---------------------------------------------------------------------

export function reminderMessage(companyName: string, invoice: InvoiceWithDetail, rank: number): { subject: string; message: string } {
  const remaining = euros(remainingAmount(invoice));
  const due = formatIsoForHumans(toIsoDate(invoice.dueDate!));
  const opening =
    rank <= 1
      ? `Sauf erreur de notre part, la facture ${invoice.number} arrivée à échéance le ${due} reste à régler, pour un montant de ${remaining}.`
      : `Malgré notre précédent message, la facture ${invoice.number} arrivée à échéance le ${due} demeure impayée, pour un montant de ${remaining}.`;
  return {
    subject: `${rank <= 1 ? "Rappel" : `Relance n° ${rank}`} — facture ${invoice.number} en attente de règlement`,
    message: `Bonjour,\n\n${opening}\n\nNous vous remercions de bien vouloir procéder à son règlement dans les meilleurs délais. Si celui-ci a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nVous trouverez la facture en pièce jointe.\n\nCordialement,\n${companyName}`,
  };
}

/**
 * Relance une facture échue (manuellement, ou par l'automatisation quotidienne).
 * Sans adresse e-mail pour le client, la relance est impossible et le signale.
 */
export async function sendReminder(access: CompanyAccess, sender: Sender, invoiceId: string, meta: Meta = {}): Promise<{ to: string; rank: number }> {
  const invoice = await getInvoiceDetail(access, invoiceId);
  const today = todayInParis();
  const open = invoice.type !== "CREDIT_NOTE" && ["ISSUED", "SENT", "PARTIALLY_PAID"].includes(invoice.status);
  if (!open || !invoice.dueDate || toIsoDate(invoice.dueDate) >= today) {
    throw errors.badRequest("NOT_OVERDUE", "Seule une facture échue et non soldée peut être relancée.");
  }
  if (!invoice.customer.email) {
    throw errors.badRequest("CUSTOMER_EMAIL_MISSING", "Ce client n'a pas d'adresse e-mail : complétez sa fiche pour pouvoir le relancer.");
  }
  const rank = invoice.reminderCount + 1;
  const { subject, message } = reminderMessage(access.company.name, invoice, rank);
  const { pdf, fileName } = await renderInvoicePdf(access, invoice);
  await sendMail({
    ...mailTemplates.documentEmail({ to: invoice.customer.email, subject, message, senderName: access.company.name, replyTo: access.company.email ?? sender?.email }),
    attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { reminderCount: rank, lastReminderAt: new Date() } });
  await recordAudit({
    action: "invoice.reminder",
    userId: sender?.id ?? null,
    companyId: access.company.id,
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { detail: `Relance n° ${rank} envoyée à ${invoice.customer.email}`, rank, automatic: sender === null },
    ...meta,
  });
  return { to: invoice.customer.email, rank };
}

/** Accès « système » à une entreprise, pour les automatisations : celui de son propriétaire. */
export async function systemAccess(companyId: string): Promise<CompanyAccess | null> {
  const owner = await prisma.companyUser.findFirst({ where: { companyId, status: "ACTIVE", role: { key: "OWNER" } }, select: { userId: true } });
  if (!owner) return null;
  const access = await getCompanyAccess(owner.userId, companyId);
  return access && access.company.status === "ACTIVE" ? access : null;
}

function delaysOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((d): d is number => typeof d === "number" && d > 0).sort((a, b) => a - b) : [];
}

/**
 * Relances automatiques : pour chaque entreprise qui les a activées, relance les
 * factures échues lorsque le délai de la relance suivante est atteint
 * (ex. 7, 15 puis 30 jours après l'échéance). Une seule relance par facture et par jour.
 */
export async function runAutomaticReminders(today: IsoDate = todayInParis()): Promise<{ sent: number; skipped: number; errors: number }> {
  const result = { sent: 0, skipped: 0, errors: 0 };
  const companies = await prisma.company.findMany({ where: { remindersEnabled: true, status: "ACTIVE" }, select: { id: true, reminderDelaysDays: true } });
  for (const company of companies) {
    const delays = delaysOf(company.reminderDelaysDays);
    if (delays.length === 0) continue;
    const access = await systemAccess(company.id);
    if (!access) continue;
    const candidates = await access.db.invoice.findMany({
      where: {
        type: { in: ["INVOICE", "DEPOSIT"] },
        status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID"] },
        dueDate: { lt: new Date(`${today}T00:00:00Z`) },
        reminderCount: { lt: delays.length },
      },
      select: { id: true, dueDate: true, reminderCount: true, lastReminderAt: true, customer: { select: { email: true } } },
    });
    for (const invoice of candidates) {
      const daysLate = Math.round((Date.parse(`${today}T00:00:00Z`) - invoice.dueDate!.getTime()) / 86_400_000);
      const alreadyToday = invoice.lastReminderAt && todayInParis(invoice.lastReminderAt) === today;
      if (daysLate < delays[invoice.reminderCount] || alreadyToday || !invoice.customer.email) {
        result.skipped++;
        continue;
      }
      try {
        await sendReminder(access, null, invoice.id);
        result.sent++;
      } catch (error) {
        result.errors++;
        console.error(`[relances] facture ${invoice.id}`, error);
      }
    }
  }
  return result;
}
