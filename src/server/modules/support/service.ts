import { randomBytes } from "node:crypto";
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { notify } from "@/server/modules/notifications/service";

/** Tickets de support : demandes des clients (espace client, formulaire de contact) et réponses de l'équipe. */

type Meta = { ip?: string | null; userAgent?: string | null };

export function supportReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `SP-${Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("")}`;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { OPEN: "Ouvert", IN_PROGRESS: "En cours", WAITING_CUSTOMER: "En attente de votre réponse", RESOLVED: "Résolu", CLOSED: "Fermé" };

const ticketInclude = {
  messages: { orderBy: { createdAt: "asc" } },
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
} satisfies Prisma.SupportTicketInclude;

type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>;

export type TicketView = {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: string;
  createdAt: string;
  updatedAt: string;
  requester: { name: string; email: string | null; userId: string | null };
  company: { id: string; name: string } | null;
  messages: Array<{ id: string; body: string; isStaff: boolean; createdAt: string }>;
};

function serialize(row: TicketRow): TicketView {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requester: row.user ? { name: `${row.user.firstName} ${row.user.lastName}`, email: row.user.email, userId: row.user.id } : { name: row.contactName ?? "Visiteur", email: row.contactEmail, userId: null },
    company: row.company,
    messages: row.messages.map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt.toISOString() })),
  };
}

// --- Côté client ---------------------------------------------------------------------------

export async function createTicket(userId: string, input: { subject: string; message: string; companyId?: string | null }, meta: Meta = {}): Promise<TicketView> {
  if (input.companyId) {
    const member = await prisma.companyUser.findFirst({ where: { companyId: input.companyId, userId, status: "ACTIVE" } });
    if (!member) throw errors.validation([{ path: "companyId", message: "Entreprise introuvable" }]);
  }
  const ticket = await prisma.supportTicket.create({
    data: { reference: supportReference(), userId, companyId: input.companyId ?? null, source: "APP", subject: input.subject, messages: { create: { body: input.message, authorId: userId } } },
    include: ticketInclude,
  });
  await recordAudit({ action: "support.ticket_created", userId, companyId: input.companyId ?? null, entityType: "SupportTicket", entityId: ticket.id, ...meta });
  return serialize(ticket);
}

export async function listUserTickets(userId: string) {
  const rows = await prisma.supportTicket.findMany({ where: { userId }, include: ticketInclude, orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(serialize);
}

export async function getUserTicket(userId: string, ticketId: string): Promise<TicketView> {
  const row = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId }, include: ticketInclude });
  if (!row) throw errors.notFound("Demande introuvable.");
  return serialize(row);
}

export async function replyAsUser(userId: string, ticketId: string, body: string): Promise<TicketView> {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
  if (!ticket) throw errors.notFound("Demande introuvable.");
  if (ticket.status === "CLOSED") throw errors.conflict("TICKET_CLOSED", "Cette demande est fermée : ouvrez-en une nouvelle.");
  await prisma.$transaction([
    prisma.supportTicketMessage.create({ data: { ticketId, authorId: userId, body } }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { status: "OPEN" } }),
  ]);
  return getUserTicket(userId, ticketId);
}

// --- Côté équipe (administration) ---------------------------------------------------------------

export async function listTickets(filter: { status?: TicketStatus | "active"; q?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where: Prisma.SupportTicketWhereInput = {};
  if (filter.status === "active") where.status = { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] };
  else if (filter.status) where.status = filter.status;
  if (filter.q) where.OR = [{ reference: { contains: filter.q } }, { subject: { contains: filter.q } }, { contactEmail: { contains: filter.q } }, { user: { email: { contains: filter.q } } }];
  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({ where, include: ticketInclude, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], skip: (page - 1) * 30, take: 30 }),
    prisma.supportTicket.count({ where }),
  ]);
  return { items: rows.map(serialize), total, page, pageSize: 30 };
}

export async function getTicket(ticketId: string): Promise<TicketView> {
  const row = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: ticketInclude });
  if (!row) throw errors.notFound("Ticket introuvable.");
  return serialize(row);
}

export async function replyAsStaff(adminId: string, ticketId: string, input: { body: string; status: TicketStatus }, meta: Meta = {}): Promise<TicketView> {
  const ticket = await getTicket(ticketId);
  await prisma.$transaction([
    prisma.supportTicketMessage.create({ data: { ticketId, authorId: adminId, isStaff: true, body: input.body } }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { status: input.status, closedAt: input.status === "CLOSED" ? new Date() : null } }),
  ]);
  const inApp = Boolean(ticket.requester.userId);
  if (ticket.requester.email) {
    await sendMail(mailTemplates.supportReply(ticket.requester.email, ticket.requester.name, ticket.reference, ticket.subject, input.body, inApp)).catch((error) => console.error("[support] e-mail de réponse", error));
  }
  if (ticket.requester.userId) await notify(ticket.requester.userId, { type: "support.reply", title: `Réponse à votre demande ${ticket.reference}`, link: `/app/support/${ticketId}` });
  await recordAudit({ action: "admin.support_reply", userId: adminId, actorType: "SUPER_ADMIN", entityType: "SupportTicket", entityId: ticketId, metadata: { status: input.status }, ...meta });
  return getTicket(ticketId);
}

export async function updateTicket(adminId: string, ticketId: string, input: { status?: TicketStatus; priority?: TicketPriority }, meta: Meta = {}): Promise<TicketView> {
  await getTicket(ticketId);
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { ...input, ...(input.status ? { closedAt: input.status === "CLOSED" ? new Date() : null } : {}) } });
  await recordAudit({ action: "admin.support_update", userId: adminId, actorType: "SUPER_ADMIN", entityType: "SupportTicket", entityId: ticketId, metadata: input, ...meta });
  return getTicket(ticketId);
}
