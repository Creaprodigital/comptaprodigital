import type { Prisma, RecurrenceFrequency, RecurringInvoice, RecurringStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { companyHasModule } from "@/server/modules/plans/service";
import { addDays, addMonths, fromIsoDate, toIsoDate, todayInParis, type IsoDate } from "@/lib/dates";
import { computeDocumentTotals } from "@/lib/invoicing";
import type { DocumentLineInput, RecurringInvoiceInput } from "@/lib/schemas/invoicing";
import { createInvoiceDraft, issueInvoice } from "@/server/modules/invoicing/invoices";
import { defaultInvoiceMessage, sendInvoiceByEmail, systemAccess } from "@/server/modules/invoicing/sending";
import { prepareDocumentLines, resolveActiveCustomer, type Meta } from "@/server/modules/invoicing/shared";

/** Modèle rejoué à chaque échéance. */
type Template = {
  subject?: string;
  notes?: string;
  operationCategory: "SERVICES" | "GOODS" | "MIXED";
  items: DocumentLineInput[];
};

export type RecurringView = {
  id: string;
  label: string;
  customerId: string;
  customerName: string;
  frequency: RecurrenceFrequency;
  nextRunDate: string;
  endDate: string | null;
  autoIssue: boolean;
  autoSend: boolean;
  status: RecurringStatus;
  lastRunAt: string | null;
  totalInclTax: string;
  invoiceCount: number;
};

async function assertModule(access: CompanyAccess) {
  if (!(await companyHasModule(access.company.id, "invoicing-advanced"))) {
    throw new AppError(403, "PLAN_FEATURE_UNAVAILABLE", "Les factures récurrentes sont incluses à partir de la formule Pro.");
  }
}

function templateOf(recurring: Pick<RecurringInvoice, "template">): Template {
  return recurring.template as unknown as Template;
}

function templateTotal(template: Template): string {
  try {
    return computeDocumentTotals(template.items).totalInclTax.toFixed(2);
  } catch {
    return "0.00";
  }
}

export function nextOccurrence(date: IsoDate, frequency: RecurrenceFrequency): IsoDate {
  switch (frequency) {
    case "WEEKLY":
      return addDays(date, 7);
    case "MONTHLY":
      return addMonths(date, 1);
    case "QUARTERLY":
      return addMonths(date, 3);
    case "YEARLY":
      return addMonths(date, 12);
  }
}

export async function listRecurringInvoices(access: CompanyAccess): Promise<RecurringView[]> {
  const rows = await access.db.recurringInvoice.findMany({
    include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
    orderBy: [{ status: "asc" }, { nextRunDate: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    customerId: row.customerId,
    customerName: row.customer.name,
    frequency: row.frequency,
    nextRunDate: toIsoDate(row.nextRunDate),
    endDate: row.endDate ? toIsoDate(row.endDate) : null,
    autoIssue: row.autoIssue,
    autoSend: row.autoSend,
    status: row.status,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    totalInclTax: templateTotal(templateOf(row)),
    invoiceCount: row._count.invoices,
  }));
}

export async function createRecurringInvoice(access: CompanyAccess, userId: string, input: RecurringInvoiceInput, meta: Meta = {}): Promise<RecurringInvoice> {
  await assertModule(access);
  if (input.nextRunDate < todayInParis()) {
    throw errors.validation([{ path: "nextRunDate", message: "La première échéance ne peut pas être dans le passé" }]);
  }
  const customer = await resolveActiveCustomer(access, input.customerId);
  // Les lignes du modèle passent les mêmes contrôles qu'une facture.
  await prepareDocumentLines(access, input.items, { type: "NONE", value: "0" });
  const template: Template = { subject: input.subject, notes: input.notes, operationCategory: input.operationCategory, items: input.items };
  const recurring = await access.db.recurringInvoice.create({
    data: {
      companyId: access.company.id,
      customerId: customer.id,
      label: input.label,
      frequency: input.frequency,
      nextRunDate: fromIsoDate(input.nextRunDate),
      endDate: input.endDate ? fromIsoDate(input.endDate) : null,
      autoIssue: input.autoIssue,
      autoSend: input.autoSend,
      template: template as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAudit({ action: "recurring_invoice.create", userId, companyId: access.company.id, entityType: "RecurringInvoice", entityId: recurring.id, ...meta });
  return recurring;
}

export async function setRecurringStatus(access: CompanyAccess, userId: string, recurringId: string, status: RecurringStatus, meta: Meta = {}): Promise<void> {
  const recurring = await access.db.recurringInvoice.findFirst({ where: { id: recurringId } });
  if (!recurring) throw errors.notFound("Facture récurrente introuvable.");
  if (recurring.status === "ENDED") throw errors.conflict("RECURRING_ENDED", "Cette récurrence est terminée et ne peut pas être relancée.");
  const today = todayInParis();
  // À la reprise, on ne rattrape pas les échéances manquées pendant la pause.
  let nextRunDate = toIsoDate(recurring.nextRunDate);
  if (status === "ACTIVE") while (nextRunDate < today) nextRunDate = nextOccurrence(nextRunDate, recurring.frequency);
  await access.db.recurringInvoice.update({ where: { id: recurringId }, data: { status, nextRunDate: fromIsoDate(nextRunDate) } });
  await recordAudit({ action: `recurring_invoice.${status.toLowerCase()}`, userId, companyId: access.company.id, entityType: "RecurringInvoice", entityId: recurringId, ...meta });
}

export async function deleteRecurringInvoice(access: CompanyAccess, userId: string, recurringId: string, meta: Meta = {}): Promise<void> {
  const deleted = await access.db.recurringInvoice.deleteMany({ where: { id: recurringId } });
  if (deleted.count === 0) throw errors.notFound("Facture récurrente introuvable.");
  await recordAudit({ action: "recurring_invoice.delete", userId, companyId: access.company.id, entityType: "RecurringInvoice", entityId: recurringId, ...meta });
}

const MAX_CATCH_UP = 12;

/**
 * Génère les factures des récurrences arrivées à échéance (tâche quotidienne).
 * Chaque facture est datée du jour de sa génération, pour respecter la chronologie
 * de la numérotation ; selon le réglage, elle reste en brouillon, est émise, puis envoyée.
 */
export async function runRecurringInvoices(today: IsoDate = todayInParis()): Promise<{ generated: number; issued: number; sent: number; errors: number }> {
  const result = { generated: 0, issued: 0, sent: 0, errors: 0 };
  const due = await prisma.recurringInvoice.findMany({
    where: { status: "ACTIVE", nextRunDate: { lte: fromIsoDate(today) }, company: { status: "ACTIVE" } },
    orderBy: { nextRunDate: "asc" },
  });

  for (const recurring of due) {
    try {
      const access = await systemAccess(recurring.companyId);
      if (!access || !(await companyHasModule(recurring.companyId, "invoicing-advanced"))) continue;
      const template = templateOf(recurring);
      let runDate = toIsoDate(recurring.nextRunDate);
      const endDate = recurring.endDate ? toIsoDate(recurring.endDate) : null;
      let iterations = 0;

      while (runDate <= today && (!endDate || runDate <= endDate) && iterations < MAX_CATCH_UP) {
        iterations++;
        const draft = await createInvoiceDraft(
          access,
          null,
          {
            customerId: recurring.customerId,
            issueDate: today,
            serviceDate: runDate,
            subject: template.subject ?? recurring.label,
            notes: template.notes,
            discountType: "NONE",
            discountValue: "0",
            operationCategory: template.operationCategory,
            items: template.items,
          },
          {},
          { recurringInvoiceId: recurring.id },
        );
        result.generated++;
        if (recurring.autoIssue) {
          const issued = await issueInvoice(access, null, draft.id);
          result.issued++;
          if (recurring.autoSend && issued.customer.email) {
            const { subject, message } = defaultInvoiceMessage(access.company.name, issued);
            await sendInvoiceByEmail(access, null, issued.id, { to: issued.customer.email, subject, message });
            result.sent++;
          }
        }
        runDate = nextOccurrence(runDate, recurring.frequency);
      }

      const ended = endDate !== null && runDate > endDate;
      await prisma.recurringInvoice.update({
        where: { id: recurring.id },
        data: { nextRunDate: fromIsoDate(runDate), lastRunAt: new Date(), status: ended ? "ENDED" : "ACTIVE" },
      });
    } catch (error) {
      result.errors++;
      console.error(`[récurrence] ${recurring.id}`, error);
    }
  }
  return result;
}
