import { randomBytes } from "node:crypto";
import { Prisma, type EInvoiceStatus, type EInvoiceTransmission } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { sha256Hex } from "@/server/security/crypto";
import { getDecrypted, putEncrypted } from "@/server/storage";
import type { Meta } from "@/server/modules/invoicing/shared";
import { storeSystemDocument } from "@/server/modules/documents/service";
import { createPurchase, createSupplier } from "@/server/modules/purchases/service";
import { dec, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { LIFECYCLE, REASON_REQUIRED, RECIPIENT_STATUSES, TERMINAL_CODES, isLifecycleCode, lifecycleLabel, summarize, type RecipientStatus } from "./lifecycle";
import { getEInvoicePlatform, type EInvoicePlatform, type IncomingInvoiceFile, type LifecycleUpdate } from "./platform";
import { EInvoiceParseError, parseIncomingInvoice } from "./parse";

/**
 * Facturation électronique par plateforme agréée.
 *
 *  - Émission : une facture émise dont l'original archivé est au format Factur-X (EN 16931), adressée à
 *    une entreprise française identifiée par son SIREN, est déposée à la demande de l'utilisateur. Le dépôt
 *    passe par une file (nouvelles tentatives espacées, reprise après interruption, clé d'idempotence) ;
 *    le fichier transmis est l'original archivé, contrôlé par son empreinte.
 *  - Cycle de vie : les statuts de la plateforme et du client sont enregistrés une seule fois chacun et
 *    résumés sur la facture (déposée, rejetée, refusée, en litige, encaissée…). Le statut « Encaissée » est
 *    déclaré par l'utilisateur, jamais automatiquement.
 *  - Réception : les factures reçues sont rattachées à l'entreprise qui a activé la réception (SIREN
 *    unique), leur XML est conservé chiffré, leur PDF classé dans les documents ; l'utilisateur les
 *    enregistre en achat, ou les refuse avec un motif transmis au fournisseur.
 *
 * Sans plateforme raccordée, toutes les opérations sont refusées (503) et rien n'est affiché.
 */

const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
const STALE_SENDING_MS = 15 * 60_000;
const CURSOR_KEY = "einvoicing.cursor";

export function einvoicingAvailable(): boolean {
  return getEInvoicePlatform() !== null;
}

function requirePlatform(): EInvoicePlatform {
  const platform = getEInvoicePlatform();
  if (!platform) throw new AppError(503, "EINVOICING_UNAVAILABLE", "Aucune plateforme de facturation électronique n'est raccordée.");
  return platform;
}

// --- Émission -------------------------------------------------------------------------------------

const ACTIVE_INVOICE_SELECT = {
  id: true,
  number: true,
  type: true,
  status: true,
  eInvoiceFormat: true,
  eInvoiceStatus: true,
  pdfDocumentId: true,
  totalInclTax: true,
  customer: { select: { name: true, type: true, siren: true, country: true } },
} satisfies Prisma.InvoiceSelect;

type ScopedInvoice = Prisma.InvoiceGetPayload<{ select: typeof ACTIVE_INVOICE_SELECT }>;

/** Conditions de dépôt : facture émise, original Factur-X archivé, échange entre entreprises françaises identifiées. */
function scopeProblems(access: CompanyAccess, invoice: ScopedInvoice): string[] {
  const problems: string[] = [];
  if (invoice.status === "DRAFT" || !invoice.number) problems.push("La facture doit d'abord être émise.");
  if (invoice.status === "CANCELLED") problems.push("La facture est annulée.");
  if (!access.company.siren) problems.push("Le SIREN de l'entreprise n'est pas renseigné.");
  if (invoice.customer.type !== "COMPANY" || !invoice.customer.siren || invoice.customer.country !== "FR") {
    problems.push("Le client doit être une entreprise française identifiée par son SIREN : les autres opérations relèvent du e-reporting, pas de la facturation électronique.");
  }
  if (invoice.eInvoiceFormat !== "FACTUR_X" || !invoice.pdfDocumentId) problems.push("L'original archivé de la facture n'est pas au format Factur-X : ses données ne respectent pas la norme EN 16931.");
  return problems;
}

export type EInvoiceView = {
  available: true;
  status: EInvoiceStatus;
  statusLabel: string;
  problems: string[];
  canSubmit: boolean;
  canDeclareCollected: boolean;
  transmissions: Array<{ id: string; status: EInvoiceTransmission["status"]; attempts: number; lastError: string | null; platformRef: string | null; sentAt: string | null; createdAt: string }>;
  events: Array<{ code: number; label: string; reason: string | null; source: string; occurredAt: string }>;
};

const STATUS_LABELS: Record<EInvoiceStatus, string> = {
  NOT_APPLICABLE: "Non transmise",
  PENDING: "En cours de dépôt",
  DEPOSITED: "Déposée",
  REJECTED: "Rejetée par la plateforme",
  ACCEPTED: "Acceptée",
  DISPUTED: "En litige",
  REFUSED: "Refusée par le client",
  PAID: "Encaissée",
};

async function findInvoice(access: CompanyAccess, invoiceId: string): Promise<ScopedInvoice> {
  const invoice = await access.db.invoice.findFirst({ where: { id: invoiceId }, select: ACTIVE_INVOICE_SELECT });
  if (!invoice) throw errors.notFound("Facture introuvable.");
  return invoice;
}

/** Dernier dépôt en cours ou abouti (un dépôt rejeté ou en échec définitif peut être refait). */
async function currentTransmission(companyId: string, invoiceId: string) {
  const latest = await prisma.eInvoiceTransmission.findFirst({ where: { companyId, invoiceId }, orderBy: { createdAt: "desc" }, include: { events: true } });
  if (!latest || latest.status === "FAILED" || latest.events.some((e) => e.code === 213)) return { latest, active: null };
  return { latest, active: latest };
}

export async function getInvoiceEInvoicing(access: CompanyAccess, invoiceId: string): Promise<EInvoiceView | null> {
  if (!einvoicingAvailable()) return null;
  const invoice = await findInvoice(access, invoiceId);
  const [transmissions, { active }] = await Promise.all([
    access.db.eInvoiceTransmission.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, include: { events: { orderBy: [{ occurredAt: "asc" }, { code: "asc" }] } } }),
    currentTransmission(access.company.id, invoiceId),
  ]);
  const problems = scopeProblems(access, invoice);
  const fullyPaid = invoice.status === "PAID";
  const activeEvents = active?.events ?? [];
  return {
    available: true,
    status: invoice.eInvoiceStatus,
    statusLabel: STATUS_LABELS[invoice.eInvoiceStatus],
    problems,
    canSubmit: problems.length === 0 && !active,
    canDeclareCollected: Boolean(active?.status === "SENT" && fullyPaid && !activeEvents.some((e) => TERMINAL_CODES.has(e.code))),
    transmissions: transmissions.map((t) => ({ id: t.id, status: t.status, attempts: t.attempts, lastError: t.lastError, platformRef: t.platformRef, sentAt: t.sentAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() })),
    events: transmissions
      .flatMap((t) => t.events)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.code - b.code)
      .map((e) => ({ code: e.code, label: lifecycleLabel(e.code), reason: e.reason, source: e.source, occurredAt: e.occurredAt.toISOString() })),
  };
}

/** Dépôt demandé par l'utilisateur : mise en file, puis première tentative immédiate. */
export async function submitInvoice(access: CompanyAccess, userId: string, invoiceId: string, meta: Meta = {}): Promise<EInvoiceView> {
  const platform = requirePlatform();
  const invoice = await findInvoice(access, invoiceId);
  const problems = scopeProblems(access, invoice);
  if (problems.length) throw errors.badRequest("EINVOICE_NOT_ELIGIBLE", problems.join(" "));
  const transmission = await prisma.$transaction(async (tx) => {
    // Verrou sur la facture : deux demandes simultanées ne créent qu'un dépôt.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND companyId = ${access.company.id} FOR UPDATE`;
    const latest = await tx.eInvoiceTransmission.findFirst({ where: { invoiceId, companyId: access.company.id }, orderBy: { createdAt: "desc" }, include: { events: { select: { code: true } } } });
    if (latest && latest.status !== "FAILED" && !latest.events.some((e) => e.code === 213)) throw errors.conflict("EINVOICE_ALREADY_SUBMITTED", "Cette facture a déjà été transmise à la plateforme.");
    const created = await tx.eInvoiceTransmission.create({ data: { companyId: access.company.id, invoiceId, platform: platform.key, format: "FACTUR_X", requestedById: userId } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { eInvoiceStatus: "PENDING" } });
    await recordAudit({ action: "einvoice.submitted", userId, companyId: access.company.id, entityType: "Invoice", entityId: invoiceId, metadata: { detail: `Facture ${invoice.number} mise en file de dépôt (${platform.label})`, transmissionId: created.id }, ...meta }, tx);
    return created;
  });
  await processTransmission(transmission.id);
  return (await getInvoiceEInvoicing(access, invoiceId))!;
}

/** Une tentative de dépôt. Ne lève pas : l'échec est enregistré et une nouvelle tentative planifiée. */
export async function processTransmission(transmissionId: string, now = new Date()): Promise<"sent" | "retry" | "failed" | "skipped"> {
  const platform = getEInvoicePlatform();
  if (!platform) return "skipped";
  const claimed = await prisma.eInvoiceTransmission.updateMany({ where: { id: transmissionId, status: "QUEUED", nextAttemptAt: { lte: now }, platform: platform.key }, data: { status: "SENDING", attempts: { increment: 1 } } });
  if (claimed.count === 0) return "skipped";
  const transmission = await prisma.eInvoiceTransmission.findUniqueOrThrow({ where: { id: transmissionId }, include: { invoice: { include: { customer: true, company: true } } } });
  const { invoice } = transmission;
  try {
    const document = invoice.pdfDocumentId ? await prisma.document.findFirst({ where: { id: invoice.pdfDocumentId, companyId: transmission.companyId } }) : null;
    if (!document) throw new Error("original archivé introuvable");
    const content = await getDecrypted(document.storageKey);
    if (!content || sha256Hex(content) !== document.checksumSha256) throw new Error("original archivé illisible ou altéré");
    const { platformRef } = await platform.submit({
      idempotencyKey: transmission.id,
      senderSiren: invoice.company.siren ?? "",
      recipientSiren: invoice.customer.siren ?? "",
      format: transmission.format,
      fileName: document.originalFileName,
      content,
      mimeType: document.mimeType,
    });
    await prisma.$transaction(async (tx) => {
      await tx.eInvoiceTransmission.update({ where: { id: transmission.id }, data: { status: "SENT", platformRef: platformRef.slice(0, 191), sentAt: now, lastError: null, fileChecksum: document.checksumSha256 } });
      await insertEvent(tx, { companyId: transmission.companyId, transmissionId: transmission.id, code: 200, source: "PLATFORM", occurredAt: now });
      await refreshInvoiceStatus(tx, transmission.id);
      await recordAudit({ action: "einvoice.deposited", companyId: transmission.companyId, entityType: "Invoice", entityId: invoice.id, metadata: { detail: `Facture ${invoice.number} déposée (${platform.label}, dépôt ${platformRef})`, platformRef } }, tx);
    });
    return "sent";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const exhausted = transmission.attempts >= MAX_ATTEMPTS;
    await prisma.eInvoiceTransmission.update({
      where: { id: transmission.id },
      data: exhausted ? { status: "FAILED", lastError: message } : { status: "QUEUED", lastError: message, nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(transmission.attempts - 1, RETRY_DELAYS_MS.length - 1)]) },
    });
    if (exhausted) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { eInvoiceStatus: "NOT_APPLICABLE" } });
      await recordAudit({ action: "einvoice.failed", companyId: transmission.companyId, entityType: "Invoice", entityId: invoice.id, metadata: { detail: `Dépôt de la facture ${invoice.number} abandonné après ${transmission.attempts} tentatives : ${message}` } });
    }
    await prisma.applicationError.create({ data: { message: `Dépôt de facture électronique : ${message}`, path: `einvoice:${transmission.id}` } }).catch(() => undefined);
    return exhausted ? "failed" : "retry";
  }
}

/** File d'envoi : dépôts dus, et reprise des dépôts interrompus (l'idempotence évite un double dépôt). */
export async function processEInvoiceQueue(now = new Date()): Promise<{ sent: number; retried: number; failed: number }> {
  const result = { sent: 0, retried: 0, failed: 0 };
  if (!einvoicingAvailable()) return result;
  await prisma.eInvoiceTransmission.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } }, data: { status: "QUEUED" } });
  const due = await prisma.eInvoiceTransmission.findMany({ where: { status: "QUEUED", nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 200, select: { id: true } });
  for (const { id } of due) {
    const outcome = await processTransmission(id, now);
    if (outcome === "sent") result.sent++;
    else if (outcome === "retry") result.retried++;
    else if (outcome === "failed") result.failed++;
  }
  return result;
}

// --- Cycle de vie ---------------------------------------------------------------------------------

/** Dépôt et rejet sont uniques par dépôt ; les autres statuts le sont par date. */
function dedupKey(scope: string, code: number, occurredAt: Date): string {
  return sha256Hex(code === 200 || code === 213 ? `${scope}|${code}` : `${scope}|${code}|${occurredAt.toISOString()}`);
}

async function insertEvent(
  tx: Prisma.TransactionClient,
  input: { companyId: string; transmissionId?: string; incomingId?: string; code: number; reason?: string | null; source: string; occurredAt: Date; createdById?: string | null },
): Promise<boolean> {
  const scope = input.transmissionId ? `t:${input.transmissionId}` : `i:${input.incomingId}`;
  const key = dedupKey(scope, input.code, input.occurredAt);
  if (await tx.eInvoiceLifecycleEvent.findUnique({ where: { dedupKey: key }, select: { id: true } })) return false;
  await tx.eInvoiceLifecycleEvent.create({
    data: { companyId: input.companyId, transmissionId: input.transmissionId ?? null, incomingId: input.incomingId ?? null, code: input.code, reason: input.reason?.slice(0, 500) ?? null, source: input.source, occurredAt: input.occurredAt, createdById: input.createdById ?? null, dedupKey: key },
  });
  return true;
}

async function refreshInvoiceStatus(tx: Prisma.TransactionClient, transmissionId: string) {
  const transmission = await tx.eInvoiceTransmission.findUniqueOrThrow({ where: { id: transmissionId }, include: { events: { select: { code: true, occurredAt: true } } } });
  const status = summarize(transmission.events);
  if (status) await tx.invoice.updateMany({ where: { id: transmission.invoiceId, companyId: transmission.companyId }, data: { eInvoiceStatus: status } });
}

/** Enregistre un statut reçu de la plateforme ; retourne false s'il est inconnu, déjà reçu ou sans pièce correspondante. */
export async function recordLifecycleUpdate(update: LifecycleUpdate): Promise<boolean> {
  const platform = requirePlatform();
  if (!isLifecycleCode(update.code) || Number.isNaN(update.occurredAt.getTime())) return false;
  if (update.direction === "OUTGOING") {
    const transmission = await prisma.eInvoiceTransmission.findFirst({ where: { platform: platform.key, platformRef: update.platformRef } });
    if (!transmission) return false;
    return prisma.$transaction(async (tx) => {
      const inserted = await insertEvent(tx, { companyId: transmission.companyId, transmissionId: transmission.id, code: update.code, reason: update.reason, source: update.source, occurredAt: update.occurredAt });
      if (!inserted) return false;
      await refreshInvoiceStatus(tx, transmission.id);
      await recordAudit({ action: "einvoice.lifecycle", companyId: transmission.companyId, entityType: "Invoice", entityId: transmission.invoiceId, metadata: { detail: `Facture électronique : ${lifecycleLabel(update.code)}${update.reason ? ` (${update.reason})` : ""}`, code: update.code } }, tx);
      return true;
    });
  }
  const incoming = await prisma.eInvoiceIncoming.findUnique({ where: { platform_platformRef: { platform: platform.key, platformRef: update.platformRef } } });
  if (!incoming) return false;
  return prisma.$transaction((tx) => insertEvent(tx, { companyId: incoming.companyId, incomingId: incoming.id, code: update.code, reason: update.reason, source: update.source, occurredAt: update.occurredAt }));
}

/** Encaissement d'une facture déposée : statut 212, déclaré par l'utilisateur (jamais automatiquement). */
export async function declareCollected(access: CompanyAccess, userId: string, invoiceId: string, meta: Meta = {}): Promise<EInvoiceView> {
  const platform = requirePlatform();
  const view = await getInvoiceEInvoicing(access, invoiceId);
  if (!view?.canDeclareCollected) throw errors.conflict("EINVOICE_NOT_COLLECTABLE", "L'encaissement ne peut être déclaré que pour une facture déposée et entièrement réglée.");
  const { active } = await currentTransmission(access.company.id, invoiceId);
  await platform.sendStatus({ platformRef: active!.platformRef!, direction: "OUTGOING", code: 212 });
  await prisma.$transaction(async (tx) => {
    await insertEvent(tx, { companyId: access.company.id, transmissionId: active!.id, code: 212, source: "COMPANY", occurredAt: new Date(), createdById: userId });
    await refreshInvoiceStatus(tx, active!.id);
    await recordAudit({ action: "einvoice.collected_declared", userId, companyId: access.company.id, entityType: "Invoice", entityId: invoiceId, metadata: { detail: "Encaissement déclaré à la plateforme (statut 212)" }, ...meta }, tx);
  });
  return (await getInvoiceEInvoicing(access, invoiceId))!;
}

// --- Réception ------------------------------------------------------------------------------------

/** Active (ou désactive) la réception des factures électroniques pour l'entreprise. */
export async function setEInvoicingReception(access: CompanyAccess, userId: string, active: boolean, meta: Meta = {}): Promise<{ active: boolean }> {
  requirePlatform();
  const companyId = access.company.id;
  if (active) {
    if (!access.company.siren) throw errors.badRequest("SIREN_REQUIRED", "Renseignez le SIREN de l'entreprise pour recevoir ses factures électroniques.");
    // Un SIREN ne peut recevoir ses factures que dans une seule entreprise de la plateforme.
    const other = await prisma.company.findFirst({ where: { siren: access.company.siren, id: { not: companyId }, status: "ACTIVE", einvoicingActivatedAt: { not: null } }, select: { id: true } });
    if (other) throw errors.conflict("SIREN_ALREADY_RECEIVING", "La réception des factures électroniques de ce SIREN est déjà activée dans une autre entreprise de la plateforme.");
  }
  await prisma.company.update({ where: { id: companyId }, data: active ? { einvoicingActivatedAt: new Date(), einvoicingActivatedById: userId } : { einvoicingActivatedAt: null, einvoicingActivatedById: null } });
  await recordAudit({ action: active ? "einvoice.reception_enabled" : "einvoice.reception_disabled", userId, companyId, entityType: "Company", entityId: companyId, ...meta });
  return { active };
}

type IngestOutcome = "created" | "duplicate" | "no_company" | "invalid";

/** Facture reçue de la plateforme : rattachée à l'entreprise destinataire, conservée, à traiter. */
export async function ingestIncomingInvoice(file: IncomingInvoiceFile): Promise<IngestOutcome> {
  const platform = requirePlatform();
  if (await prisma.eInvoiceIncoming.findUnique({ where: { platform_platformRef: { platform: platform.key, platformRef: file.platformRef } }, select: { id: true } })) return "duplicate";
  const companies = await prisma.company.findMany({ where: { siren: file.recipientSiren, status: "ACTIVE", einvoicingActivatedAt: { not: null } }, select: { id: true } });
  if (companies.length !== 1) {
    await prisma.applicationError.create({ data: { message: `Facture électronique reçue (${file.platformRef}) sans entreprise destinataire unique pour le SIREN ${file.recipientSiren}`, path: "einvoice:incoming" } });
    return "no_company";
  }
  const companyId = companies[0].id;
  let summary;
  try {
    summary = parseIncomingInvoice(file.xml, file.format);
  } catch (error) {
    if (!(error instanceof EInvoiceParseError)) throw error;
    await prisma.applicationError.create({ data: { message: `Facture électronique reçue (${file.platformRef}) illisible : ${error.message}`, path: "einvoice:incoming" } });
    return "invalid";
  }
  if (summary.buyerSiren && summary.buyerSiren !== file.recipientSiren) {
    await prisma.applicationError.create({ data: { message: `Facture électronique reçue (${file.platformRef}) : SIREN de l'acheteur différent du destinataire`, path: "einvoice:incoming" } });
    return "invalid";
  }
  const xml = Buffer.from(file.xml, "utf8");
  const xmlStorageKey = `${companyId}/einvoices/${new Date().getUTCFullYear()}/${randomBytes(16).toString("hex")}`;
  await putEncrypted(xmlStorageKey, xml);
  const documentId = file.pdf
    ? await storeSystemDocument(companyId, { bytes: file.pdf, fileName: `Facture ${summary.number} - ${summary.sellerName}.pdf`.replace(/[\\/:*?"<>|]/g, "-"), category: "PURCHASE_INVOICE", documentDate: fromIsoDate(summary.issueDate), detail: "Facture électronique reçue par la plateforme" })
    : null;
  try {
    const incoming = await prisma.eInvoiceIncoming.create({
      data: {
        companyId,
        platform: platform.key,
        platformRef: file.platformRef,
        format: file.format,
        sellerName: summary.sellerName,
        sellerSiren: summary.sellerSiren,
        sellerVatNumber: summary.sellerVatNumber,
        number: summary.number.slice(0, 100),
        issueDate: fromIsoDate(summary.issueDate),
        dueDate: summary.dueDate ? fromIsoDate(summary.dueDate) : null,
        currency: summary.currency,
        totalExclTax: summary.totalExclTax,
        totalVat: summary.totalVat,
        totalInclTax: summary.totalInclTax,
        xmlStorageKey,
        xmlChecksum: sha256Hex(xml),
        documentId,
        receivedAt: file.receivedAt,
      },
    });
    await recordAudit({ action: "einvoice.received", companyId, entityType: "EInvoiceIncoming", entityId: incoming.id, metadata: { detail: `Facture ${summary.number} reçue de ${summary.sellerName} (${toMoneyString(summary.totalInclTax)} ${summary.currency})` } });
    return "created";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}

export type IncomingView = {
  id: string;
  sellerName: string;
  sellerSiren: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  totalExclTax: string;
  totalVat: string;
  totalInclTax: string;
  creditNote: boolean;
  status: "RECEIVED" | "PURCHASE_CREATED" | "REFUSED";
  lastStatus: string | null;
  documentId: string | null;
  purchaseId: string | null;
  receivedAt: string;
};

export async function listIncomingInvoices(access: CompanyAccess): Promise<IncomingView[]> {
  const rows = await access.db.eInvoiceIncoming.findMany({ orderBy: [{ status: "asc" }, { receivedAt: "desc" }], take: 200 });
  return rows.map((r) => ({
    id: r.id,
    sellerName: r.sellerName,
    sellerSiren: r.sellerSiren,
    number: r.number,
    issueDate: toIsoDate(r.issueDate),
    dueDate: r.dueDate ? toIsoDate(r.dueDate) : null,
    currency: r.currency,
    totalExclTax: toMoneyString(r.totalExclTax),
    totalVat: toMoneyString(r.totalVat),
    totalInclTax: toMoneyString(r.totalInclTax),
    creditNote: dec(r.totalInclTax).isNegative(),
    status: r.status,
    lastStatus: r.lastStatusCode ? lifecycleLabel(r.lastStatusCode) : null,
    documentId: r.documentId,
    purchaseId: r.purchaseId,
    receivedAt: r.receivedAt.toISOString(),
  }));
}

async function findIncoming(access: CompanyAccess, incomingId: string) {
  const incoming = await access.db.eInvoiceIncoming.findFirst({ where: { id: incomingId } });
  if (!incoming) throw errors.notFound("Facture reçue introuvable.");
  return incoming;
}

/** XML original d'une facture reçue (téléchargement journalisé). */
export async function incomingXml(access: CompanyAccess, userId: string, incomingId: string, meta: Meta = {}): Promise<{ fileName: string; xml: Buffer }> {
  const incoming = await findIncoming(access, incomingId);
  const xml = await getDecrypted(incoming.xmlStorageKey);
  if (!xml || sha256Hex(xml) !== incoming.xmlChecksum) throw new Error(`Facture reçue ${incoming.id} : XML absent ou altéré`);
  await recordAudit({ action: "einvoice.incoming_downloaded", userId, companyId: access.company.id, entityType: "EInvoiceIncoming", entityId: incoming.id, ...meta });
  return { fileName: `${incoming.number.replace(/[^\w.-]+/g, "_")}.xml`, xml };
}

/** Statut émis par l'entreprise destinataire (prise en charge, approbation, litige, refus…). */
export async function respondToIncoming(access: CompanyAccess, userId: string, incomingId: string, input: { code: number; reason?: string }, meta: Meta = {}): Promise<IncomingView> {
  const platform = requirePlatform();
  const incoming = await findIncoming(access, incomingId);
  if (!RECIPIENT_STATUSES.includes(input.code as RecipientStatus)) throw errors.validation([{ path: "code", message: "Statut non autorisé pour une facture reçue" }]);
  const reason = input.reason?.trim();
  if (REASON_REQUIRED.has(input.code) && !reason) throw errors.validation([{ path: "reason", message: "Indiquez le motif, transmis au fournisseur" }]);
  if (incoming.status === "REFUSED") throw errors.conflict("EINVOICE_REFUSED", "Cette facture a déjà été refusée.");
  if (input.code === 210 && incoming.status === "PURCHASE_CREATED") throw errors.conflict("EINVOICE_PURCHASE_EXISTS", "Cette facture est enregistrée en achat : annulez l'achat avant de la refuser.");
  await platform.sendStatus({ platformRef: incoming.platformRef, direction: "INCOMING", code: input.code, reason });
  await prisma.$transaction(async (tx) => {
    await insertEvent(tx, { companyId: incoming.companyId, incomingId: incoming.id, code: input.code, reason, source: "COMPANY", occurredAt: new Date(), createdById: userId });
    await tx.eInvoiceIncoming.update({ where: { id: incoming.id }, data: { lastStatusCode: input.code, ...(input.code === 210 ? { status: "REFUSED" as const } : {}) } });
    await recordAudit({ action: "einvoice.incoming_status", userId, companyId: incoming.companyId, entityType: "EInvoiceIncoming", entityId: incoming.id, metadata: { detail: `Statut « ${LIFECYCLE[input.code].label} » transmis au fournisseur${reason ? ` : ${reason}` : ""}`, code: input.code }, ...meta }, tx);
  });
  return (await listIncomingInvoices(access)).find((r) => r.id === incoming.id)!;
}

/** Enregistre la facture reçue en achat : fournisseur retrouvé (ou créé) par son SIREN, catégorie choisie par l'utilisateur. */
export async function createPurchaseFromIncoming(access: CompanyAccess, userId: string, incomingId: string, input: { categoryId: string }, meta: Meta = {}): Promise<{ purchaseId: string }> {
  const incoming = await findIncoming(access, incomingId);
  if (incoming.status !== "RECEIVED") throw errors.conflict("EINVOICE_ALREADY_PROCESSED", "Cette facture a déjà été traitée.");
  if (dec(incoming.totalExclTax).lte(0)) throw errors.badRequest("EINVOICE_CREDIT_NOTE", "Un avoir fournisseur ne s'enregistre pas en facture d'achat : imputez-le sur la facture concernée.");
  if (incoming.currency !== access.company.currency) throw errors.badRequest("CURRENCY_MISMATCH", `Facture libellée en ${incoming.currency} : saisissez-la manuellement avec sa contre-valeur.`);
  let supplier = incoming.sellerSiren ? await access.db.supplier.findFirst({ where: { siren: incoming.sellerSiren }, select: { id: true } }) : null;
  if (!supplier) supplier = { id: (await createSupplier(access, userId, { name: incoming.sellerName, siren: incoming.sellerSiren ?? undefined, vatNumber: incoming.sellerVatNumber ?? undefined, country: "FR" }, meta)).id };
  const issueDate = toIsoDate(incoming.issueDate);
  const purchase = await createPurchase(
    access,
    userId,
    {
      supplierId: supplier.id,
      reference: incoming.number,
      label: `Facture ${incoming.number} — ${incoming.sellerName}`.slice(0, 255),
      issueDate: issueDate > todayInParis() ? todayInParis() : issueDate,
      dueDate: incoming.dueDate && toIsoDate(incoming.dueDate) >= issueDate ? toIsoDate(incoming.dueDate) : undefined,
      categoryId: input.categoryId,
      operationCategory: "SERVICES",
      supplierVatOnDebits: false,
      totalExclTax: toMoneyString(incoming.totalExclTax),
      totalVat: toMoneyString(incoming.totalVat),
    },
    meta,
  );
  await prisma.$transaction(async (tx) => {
    await tx.eInvoiceIncoming.update({ where: { id: incoming.id }, data: { status: "PURCHASE_CREATED", purchaseId: purchase.id } });
    if (incoming.documentId) await tx.documentLink.create({ data: { companyId: incoming.companyId, documentId: incoming.documentId, entityType: "PURCHASE", entityId: purchase.id } });
    await recordAudit({ action: "einvoice.purchase_created", userId, companyId: incoming.companyId, entityType: "EInvoiceIncoming", entityId: incoming.id, metadata: { detail: `Enregistrée en achat`, purchaseId: purchase.id }, ...meta }, tx);
  });
  return { purchaseId: purchase.id };
}

// --- Synchronisation avec la plateforme -----------------------------------------------------------

type Cursor = { lifecycle?: string; incoming?: string };

async function readCursor(): Promise<Cursor> {
  const row = await prisma.applicationSetting.findUnique({ where: { key: CURSOR_KEY } });
  return (row?.value as Cursor | null) ?? {};
}

async function writeCursor(cursor: Cursor) {
  await prisma.applicationSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: cursor }, update: { value: cursor } });
}

/** Récupère statuts et factures reçues depuis la dernière passe (marge d'une heure : les doublons sont ignorés). */
export async function syncEInvoicing(): Promise<{ statuses: number; received: number; ignored: number }> {
  const result = { statuses: 0, received: 0, ignored: 0 };
  const platform = getEInvoicePlatform();
  if (!platform) return result;
  const cursor = await readCursor();
  const since = (iso?: string) => (iso ? new Date(Date.parse(iso) - 3600_000) : null);
  const incoming = await platform.listIncoming(since(cursor.incoming));
  let maxIncoming = cursor.incoming ? Date.parse(cursor.incoming) : 0;
  for (const file of incoming) {
    const outcome = await ingestIncomingInvoice(file);
    if (outcome === "created") result.received++;
    else if (outcome !== "duplicate") result.ignored++;
    maxIncoming = Math.max(maxIncoming, file.receivedAt.getTime());
  }
  // Après les factures reçues : un statut peut porter sur une facture arrivée dans la même passe.
  const updates = await platform.listLifecycleUpdates(since(cursor.lifecycle));
  let maxLifecycle = cursor.lifecycle ? Date.parse(cursor.lifecycle) : 0;
  for (const update of updates) {
    if (await recordLifecycleUpdate(update)) result.statuses++;
    maxLifecycle = Math.max(maxLifecycle, update.occurredAt.getTime());
  }
  await writeCursor({ incoming: maxIncoming ? new Date(maxIncoming).toISOString() : undefined, lifecycle: maxLifecycle ? new Date(maxLifecycle).toISOString() : undefined });
  return result;
}

/** Webhook de la plateforme, authentifié par l'implémentation ; retourne null s'il ne l'est pas. */
export async function handleEInvoiceWebhook(rawBody: string, headers: Headers): Promise<{ recorded: number; incomingAvailable: boolean } | null> {
  const platform = requirePlatform();
  const event = await platform.verifyWebhook(rawBody, headers);
  if (!event) return null;
  let recorded = 0;
  for (const update of event.lifecycle) if (await recordLifecycleUpdate(update)) recorded++;
  return { recorded, incomingAvailable: event.incomingAvailable };
}
