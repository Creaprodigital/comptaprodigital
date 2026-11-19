import { randomBytes } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import type { Document, DocumentCategory, DocumentLink, LinkedEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { sha256Hex } from "@/server/security/crypto";
import { getDecrypted, putEncrypted, storage } from "@/server/storage";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { refreshTransactionState } from "@/server/modules/bank/status";
import { documentHistory, type HistoryEntry, type Meta } from "@/server/modules/invoicing/shared";
import { assertFileIsSafe } from "@/server/security/antivirus";
import { DOCUMENT_CATEGORY_LABELS, MAX_DOCUMENT_BYTES, formatFileSize } from "@/lib/bank";
import { fromIsoDate, toIsoDate, formatIsoForHumans } from "@/lib/dates";
import type { DocumentLinkInput, DocumentUpdateInput, DocumentsQuery } from "@/lib/schemas/bank";

/**
 * Gestion documentaire : justificatifs et pièces de l'entreprise. Les fichiers
 * sont chiffrés dans le stockage et ne sont lisibles qu'à travers ce service,
 * après contrôle des droits sur l'entreprise.
 */

// --- Nature des fichiers ------------------------------------------------------------

export type FileType = { mimeType: "application/pdf" | "image/jpeg" | "image/png"; extension: "pdf" | "jpg" | "png" };

/** Le type est établi d'après la signature du contenu, jamais d'après l'extension ou le type annoncé. */
export function detectFileType(bytes: Buffer): FileType | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { mimeType: "application/pdf", extension: "pdf" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: "png" };
  return null;
}

// --- Vues ---------------------------------------------------------------------------

export type DocumentLinkView = { id: string; entityType: LinkedEntityType; entityId: string; label: string; href: string | null };

export type DocumentView = {
  id: string;
  name: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
  documentDate: string | null;
  createdAt: string;
  uploadedBy: string | null;
  /** Original archivé d'une facture émise : ni renommé, ni supprimé. */
  locked: boolean;
  links: DocumentLinkView[];
};

type DocumentWithLinks = Document & { links: DocumentLink[] };

async function resolveLinks(companyId: string, links: DocumentLink[]): Promise<Map<string, DocumentLinkView>> {
  const db = tenantDb(companyId);
  const idsOf = (type: LinkedEntityType) => [...new Set(links.filter((l) => l.entityType === type).map((l) => l.entityId))];
  const [transactions, invoices, quotes, purchases] = await Promise.all([
    idsOf("BANK_TRANSACTION").length ? db.bankTransaction.findMany({ where: { id: { in: idsOf("BANK_TRANSACTION") } }, select: { id: true, label: true, date: true } }) : [],
    idsOf("INVOICE").length ? db.invoice.findMany({ where: { id: { in: idsOf("INVOICE") } }, select: { id: true, number: true } }) : [],
    idsOf("QUOTE").length ? db.quote.findMany({ where: { id: { in: idsOf("QUOTE") } }, select: { id: true, number: true } }) : [],
    idsOf("PURCHASE").length ? db.purchase.findMany({ where: { id: { in: idsOf("PURCHASE") } }, select: { id: true, reference: true, label: true, supplier: { select: { name: true } } } }) : [],
  ]);
  const labels = new Map<string, { label: string; href: string }>();
  for (const t of transactions) labels.set(`BANK_TRANSACTION:${t.id}`, { label: `Opération du ${formatIsoForHumans(toIsoDate(t.date))} — ${t.label}`, href: `/app/banque/operations/${t.id}` });
  for (const i of invoices) labels.set(`INVOICE:${i.id}`, { label: `Facture ${i.number ?? "(brouillon)"}`, href: `/app/factures/${i.id}` });
  for (const q of quotes) labels.set(`QUOTE:${q.id}`, { label: `Devis ${q.number ?? "(brouillon)"}`, href: `/app/devis/${q.id}` });
  for (const p of purchases) labels.set(`PURCHASE:${p.id}`, { label: `Facture d'achat ${p.reference ?? p.label}${p.supplier ? ` — ${p.supplier.name}` : ""}`, href: `/app/achats/${p.id}` });
  return new Map(
    links.map((link) => {
      const target = labels.get(`${link.entityType}:${link.entityId}`);
      return [link.id, { id: link.id, entityType: link.entityType, entityId: link.entityId, label: target?.label ?? "Élément supprimé", href: target?.href ?? null }];
    }),
  );
}

async function toViews(companyId: string, documents: DocumentWithLinks[]): Promise<DocumentView[]> {
  const [links, uploaders, archived] = await Promise.all([
    resolveLinks(companyId, documents.flatMap((d) => d.links)),
    prisma.user.findMany({ where: { id: { in: [...new Set(documents.map((d) => d.uploadedById).filter((v): v is string => !!v))] } }, select: { id: true, firstName: true, lastName: true } }),
    documents.length ? prisma.invoice.findMany({ where: { companyId, pdfDocumentId: { in: documents.map((d) => d.id) } }, select: { pdfDocumentId: true } }) : [],
  ]);
  const names = new Map(uploaders.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const locked = new Set(archived.map((i) => i.pdfDocumentId));
  return documents.map((document) => ({
    id: document.id,
    name: document.name,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    category: document.category,
    documentDate: document.documentDate ? toIsoDate(document.documentDate) : null,
    createdAt: document.createdAt.toISOString(),
    uploadedBy: document.uploadedById ? (names.get(document.uploadedById) ?? null) : null,
    locked: locked.has(document.id),
    links: document.links.map((link) => links.get(link.id)!),
  }));
}

// --- Consultation -------------------------------------------------------------------

function listWhere(query: DocumentsQuery): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = { deletedAt: null };
  if (query.category) where.category = query.category;
  if (query.q) where.OR = [{ name: { contains: query.q } }, { originalFileName: { contains: query.q } }];
  if (query.link === "linked") where.links = { some: {} };
  if (query.link === "unlinked") where.links = { none: {} };
  if (query.from || query.to) {
    where.documentDate = { ...(query.from ? { gte: fromIsoDate(query.from) } : {}), ...(query.to ? { lte: fromIsoDate(query.to) } : {}) };
  }
  return where;
}

export async function listDocuments(access: CompanyAccess, query: DocumentsQuery = {}) {
  const { page = 1, pageSize = 30 } = query;
  const where = listWhere(query);
  const [items, total, byCategory, unlinked] = await Promise.all([
    access.db.document.findMany({ where, include: { links: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    access.db.document.count({ where }),
    access.db.document.groupBy({ by: ["category"], where: { deletedAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } }),
    access.db.document.count({ where: { deletedAt: null, links: { none: {} } } }),
  ]);
  return {
    items: await toViews(access.company.id, items),
    total,
    page,
    pageSize,
    summary: {
      total: byCategory.reduce((acc, row) => acc + row._count._all, 0),
      sizeBytes: byCategory.reduce((acc, row) => acc + (row._sum.sizeBytes ?? 0), 0),
      unlinked,
      byCategory: Object.fromEntries(byCategory.map((row) => [row.category, row._count._all])) as Partial<Record<DocumentCategory, number>>,
    },
  };
}

async function findDocument(access: CompanyAccess, documentId: string): Promise<DocumentWithLinks> {
  const document = await access.db.document.findFirst({ where: { id: documentId, deletedAt: null }, include: { links: true } });
  if (!document) throw errors.notFound("Document introuvable.");
  return document;
}

export async function getDocument(access: CompanyAccess, documentId: string): Promise<DocumentView> {
  return (await toViews(access.company.id, [await findDocument(access, documentId)]))[0];
}

export async function getDocumentHistory(access: CompanyAccess, documentId: string): Promise<HistoryEntry[]> {
  await findDocument(access, documentId);
  return documentHistory(access.company.id, "Document", documentId);
}

/** Documents associés à un élément (opération bancaire, facture, devis). */
export async function documentsForEntity(access: CompanyAccess, entityType: LinkedEntityType, entityId: string): Promise<DocumentView[]> {
  const documents = await access.db.document.findMany({
    where: { deletedAt: null, links: { some: { entityType, entityId } } },
    include: { links: true },
    orderBy: { createdAt: "asc" },
  });
  return toViews(access.company.id, documents);
}

/** Contenu déchiffré d'un document. Les téléchargements sont journalisés. */
export async function getDocumentContent(
  access: CompanyAccess,
  userId: string,
  documentId: string,
  options: { download?: boolean } = {},
  meta: Meta = {},
): Promise<{ document: Document; bytes: Buffer }> {
  const document = await findDocument(access, documentId);
  const bytes = await getDecrypted(document.storageKey);
  if (!bytes) {
    console.error(`[documents] objet absent du stockage : ${document.id}`);
    throw errors.notFound("Le fichier de ce document est introuvable dans le stockage.");
  }
  if (sha256Hex(bytes) !== document.checksumSha256) throw new Error(`Document ${document.id} : empreinte du fichier différente de celle enregistrée`);
  if (options.download) {
    await recordAudit({ action: "document.download", userId, companyId: access.company.id, entityType: "Document", entityId: document.id, metadata: { detail: "Document téléchargé" }, ...meta });
  }
  return { document, bytes };
}

// --- Ajout --------------------------------------------------------------------------

export type UploadInput = {
  fileName: string;
  bytes: Buffer;
  name?: string;
  category?: DocumentCategory;
  documentDate?: string;
  link?: DocumentLinkInput;
};

function storageKeyFor(companyId: string): string {
  return `${companyId}/${new Date().getUTCFullYear()}/${randomBytes(16).toString("hex")}`;
}

function displayName(fileName: string): string {
  return fileName.replace(/\.(pdf|jpe?g|png)$/i, "").slice(0, 255) || "Document";
}

/**
 * Enregistre un fichier. Un fichier déjà présent dans l'entreprise (même empreinte)
 * n'est pas stocké une seconde fois : le document existant est retourné, et
 * associé à l'élément demandé le cas échéant.
 */
export async function uploadDocument(access: CompanyAccess, userId: string, input: UploadInput, meta: Meta = {}): Promise<{ document: DocumentView; duplicate: boolean }> {
  const companyId = access.company.id;
  if (input.bytes.length === 0) throw errors.badRequest("EMPTY_FILE", "Le fichier est vide.");
  if (input.bytes.length > MAX_DOCUMENT_BYTES) throw errors.badRequest("FILE_TOO_LARGE", `Fichier trop volumineux (${formatFileSize(MAX_DOCUMENT_BYTES)} au maximum).`);
  const type = detectFileType(input.bytes);
  if (!type) throw errors.badRequest("UNSUPPORTED_FILE_TYPE", "Format non pris en charge : seuls les fichiers PDF, JPEG et PNG sont acceptés.");
  if (input.link) await assertEntity(access, input.link);

  const checksum = sha256Hex(input.bytes);
  // Analyse antivirus avant tout stockage (si un antivirus est configuré).
  const scan = await assertFileIsSafe(input.bytes);
  const existing = await access.db.document.findFirst({ where: { checksumSha256: checksum, deletedAt: null } });
  let documentId: string;
  if (existing) {
    documentId = existing.id;
  } else {
    const storageKey = storageKeyFor(companyId);
    await putEncrypted(storageKey, input.bytes);
    try {
      const created = await access.db.document.create({
        data: {
          companyId,
          name: (input.name ?? displayName(input.fileName)).slice(0, 255),
          originalFileName: input.fileName.slice(0, 255),
          mimeType: type.mimeType,
          sizeBytes: input.bytes.length,
          storageKey,
          checksumSha256: checksum,
          category: input.category ?? "OTHER",
          documentDate: input.documentDate ? fromIsoDate(input.documentDate) : null,
          uploadedById: userId,
        },
      });
      documentId = created.id;
    } catch (error) {
      await storage().delete(storageKey).catch(() => undefined);
      throw error;
    }
    await recordAudit({
      action: "document.upload",
      userId,
      companyId,
      entityType: "Document",
      entityId: documentId,
      metadata: { detail: `Document ajouté (${formatFileSize(input.bytes.length)})${scan.status === "clean" ? ", analysé par l'antivirus" : ""}`, checksum },
      ...meta,
    });
  }
  if (input.link) await linkDocument(access, userId, documentId, input.link, meta);
  return { document: await getDocument(access, documentId), duplicate: existing !== null };
}

/**
 * Archive l'original d'une facture émise (appel système, sans utilisateur).
 * Le document est rattaché à la facture et ne peut plus être supprimé.
 */
export async function archiveInvoicePdf(companyId: string, invoice: { id: string; number: string | null; issueDate: Date | null }, pdf: Buffer, fileName: string): Promise<void> {
  const storageKey = storageKeyFor(companyId);
  await putEncrypted(storageKey, pdf);
  try {
    await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          companyId,
          name: fileName.replace(/\.pdf$/i, ""),
          originalFileName: fileName,
          mimeType: "application/pdf",
          sizeBytes: pdf.length,
          storageKey,
          checksumSha256: sha256Hex(pdf),
          category: "SALES_INVOICE",
          documentDate: invoice.issueDate,
        },
      });
      await tx.documentLink.create({ data: { companyId, documentId: document.id, entityType: "INVOICE", entityId: invoice.id } });
      await tx.invoice.updateMany({ where: { id: invoice.id, companyId }, data: { pdfDocumentId: document.id } });
      await recordAudit({ action: "document.archive_invoice", companyId, entityType: "Document", entityId: document.id, metadata: { detail: `Original de « ${fileName} » archivé à l'émission` } }, tx);
    });
  } catch (error) {
    await storage().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

// --- Modification, suppression ----------------------------------------------------------

async function assertNotLocked(access: CompanyAccess, documentId: string) {
  const invoice = await access.db.invoice.findFirst({ where: { pdfDocumentId: documentId }, select: { number: true } });
  if (invoice) throw errors.conflict("DOCUMENT_LOCKED", `Ce document est l'original archivé de la facture ${invoice.number ?? ""} : il ne peut être ni modifié ni supprimé.`);
}

export async function updateDocument(access: CompanyAccess, userId: string, documentId: string, input: DocumentUpdateInput, meta: Meta = {}): Promise<DocumentView> {
  const document = await findDocument(access, documentId);
  await assertNotLocked(access, documentId);
  const changes: string[] = [];
  if (input.name !== document.name) changes.push(`Nom : « ${document.name} » → « ${input.name} »`);
  if (input.category !== document.category) changes.push(`Catégorie : ${DOCUMENT_CATEGORY_LABELS[document.category]} → ${DOCUMENT_CATEGORY_LABELS[input.category]}`);
  const previousDate = document.documentDate ? toIsoDate(document.documentDate) : undefined;
  if (input.documentDate !== previousDate) changes.push(input.documentDate ? `Date du document : ${formatIsoForHumans(input.documentDate)}` : "Date du document effacée");
  if (changes.length === 0) return getDocument(access, documentId);
  await access.db.document.update({
    where: { id: documentId },
    data: { name: input.name, category: input.category, documentDate: input.documentDate ? fromIsoDate(input.documentDate) : null },
  });
  await recordAudit({ action: "document.update", userId, companyId: access.company.id, entityType: "Document", entityId: documentId, metadata: { detail: changes.join(" · ") }, ...meta });
  return getDocument(access, documentId);
}

/**
 * Suppression : le document quitte l'espace de l'entreprise et ses associations
 * sont retirées. Le fichier chiffré est effacé du stockage par la tâche quotidienne
 * après un délai de 30 jours.
 */
export async function deleteDocument(access: CompanyAccess, userId: string, documentId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  const document = await findDocument(access, documentId);
  await assertNotLocked(access, documentId);
  await prisma.$transaction(async (tx) => {
    await tx.documentLink.deleteMany({ where: { companyId, documentId } });
    await tx.document.updateMany({ where: { id: documentId, companyId }, data: { deletedAt: new Date() } });
    for (const link of document.links) {
      if (link.entityType === "BANK_TRANSACTION") {
        await refreshTransactionState(tx, companyId, link.entityId);
        await recordAudit({ action: "bank.transaction.document_removed", userId, companyId, entityType: "BankTransaction", entityId: link.entityId, metadata: { detail: `Justificatif « ${document.name} » supprimé` }, ...meta }, tx);
      }
    }
    await recordAudit({ action: "document.delete", userId, companyId, entityType: "Document", entityId: documentId, metadata: { detail: `Document « ${document.name} » supprimé`, checksum: document.checksumSha256 }, ...meta }, tx);
  });
}

/** Efface définitivement les fichiers des documents supprimés depuis plus de `days` jours (tâche quotidienne). */
export async function purgeDeletedDocuments(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const documents = await prisma.document.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, storageKey: true }, take: 500 });
  for (const document of documents) {
    await storage().delete(document.storageKey);
    await prisma.document.delete({ where: { id: document.id } });
  }
  return documents.length;
}

// --- Associations -----------------------------------------------------------------------

async function assertEntity(access: CompanyAccess, link: DocumentLinkInput): Promise<string> {
  if (link.entityType === "BANK_TRANSACTION") {
    const transaction = await access.db.bankTransaction.findFirst({ where: { id: link.entityId }, select: { label: true } });
    if (!transaction) throw errors.notFound("Opération bancaire introuvable.");
    return `l'opération « ${transaction.label} »`;
  }
  if (link.entityType === "INVOICE") {
    const invoice = await access.db.invoice.findFirst({ where: { id: link.entityId }, select: { number: true } });
    if (!invoice) throw errors.notFound("Facture introuvable.");
    return `la facture ${invoice.number ?? "(brouillon)"}`;
  }
  if (link.entityType === "PURCHASE") {
    const purchase = await access.db.purchase.findFirst({ where: { id: link.entityId }, select: { reference: true, label: true } });
    if (!purchase) throw errors.notFound("Facture d'achat introuvable.");
    return `la facture d'achat ${purchase.reference ?? purchase.label}`;
  }
  const quote = await access.db.quote.findFirst({ where: { id: link.entityId }, select: { number: true } });
  if (!quote) throw errors.notFound("Devis introuvable.");
  return `le devis ${quote.number ?? "(brouillon)"}`;
}

export async function linkDocument(access: CompanyAccess, userId: string, documentId: string, link: DocumentLinkInput, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  const document = await findDocument(access, documentId);
  const target = await assertEntity(access, link);
  if (document.links.some((l) => l.entityType === link.entityType && l.entityId === link.entityId)) return;
  await prisma.$transaction(async (tx) => {
    await tx.documentLink.create({ data: { companyId, documentId, entityType: link.entityType, entityId: link.entityId } });
    if (link.entityType === "BANK_TRANSACTION") {
      await refreshTransactionState(tx, companyId, link.entityId);
      await recordAudit({ action: "bank.transaction.document_linked", userId, companyId, entityType: "BankTransaction", entityId: link.entityId, metadata: { detail: `Justificatif « ${document.name} » associé` }, ...meta }, tx);
    }
    await recordAudit({ action: "document.link", userId, companyId, entityType: "Document", entityId: documentId, metadata: { detail: `Associé à ${target}` }, ...meta }, tx);
  });
}

export async function unlinkDocument(access: CompanyAccess, userId: string, documentId: string, linkId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  const document = await findDocument(access, documentId);
  const link = document.links.find((l) => l.id === linkId);
  if (!link) throw errors.notFound("Association introuvable.");
  if (link.entityType === "INVOICE") {
    const archived = await access.db.invoice.findFirst({ where: { id: link.entityId, pdfDocumentId: documentId }, select: { id: true } });
    if (archived) throw errors.conflict("DOCUMENT_LOCKED", "L'original archivé d'une facture reste rattaché à cette facture.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.documentLink.deleteMany({ where: { id: linkId, companyId } });
    if (link.entityType === "BANK_TRANSACTION") {
      await refreshTransactionState(tx, companyId, link.entityId);
      await recordAudit({ action: "bank.transaction.document_removed", userId, companyId, entityType: "BankTransaction", entityId: link.entityId, metadata: { detail: `Justificatif « ${document.name} » dissocié` }, ...meta }, tx);
    }
    await recordAudit({ action: "document.unlink", userId, companyId, entityType: "Document", entityId: documentId, metadata: { detail: "Association retirée" }, ...meta }, tx);
  });
}

// --- Export des archives ------------------------------------------------------------------

const EXPORT_MAX_FILES = 300;
const EXPORT_MAX_BYTES = 150 * 1024 * 1024;

/** Archive ZIP des documents correspondant aux filtres, classés par catégorie, avec un index CSV. */
export async function exportDocumentsArchive(access: CompanyAccess, userId: string, query: DocumentsQuery, meta: Meta = {}): Promise<{ fileName: string; zip: Buffer; count: number }> {
  const where = listWhere(query);
  const [count, size] = await Promise.all([access.db.document.count({ where }), access.db.document.aggregate({ where, _sum: { sizeBytes: true } })]);
  if (count === 0) throw errors.badRequest("NOTHING_TO_EXPORT", "Aucun document ne correspond à ces critères.");
  if (count > EXPORT_MAX_FILES || (size._sum.sizeBytes ?? 0) > EXPORT_MAX_BYTES) {
    throw errors.badRequest("EXPORT_TOO_LARGE", `L'export est limité à ${EXPORT_MAX_FILES} documents et ${formatFileSize(EXPORT_MAX_BYTES)} : affinez les filtres (catégorie, période) et exportez en plusieurs fois.`);
  }
  const documents = await access.db.document.findMany({ where, include: { links: true }, orderBy: [{ category: "asc" }, { documentDate: "asc" }, { createdAt: "asc" }] });
  const views = new Map((await toViews(access.company.id, documents)).map((view) => [view.id, view]));

  const files: Zippable = {};
  const used = new Set<string>();
  const rows: string[][] = [];
  for (const document of documents) {
    const bytes = await getDecrypted(document.storageKey);
    if (!bytes) throw new Error(`Document ${document.id} : objet absent du stockage`);
    const extension = detectFileType(bytes)?.extension ?? "bin";
    const folder = DOCUMENT_CATEGORY_LABELS[document.category];
    const date = document.documentDate ? `${toIsoDate(document.documentDate)}_` : "";
    const base = `${date}${document.name}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
    let path = `${folder}/${base}.${extension}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}/${base} (${n}).${extension}`;
    used.add(path.toLowerCase());
    // PDF et images sont déjà compressés : simple stockage dans l'archive.
    files[path] = [new Uint8Array(bytes), { level: 0, mtime: document.createdAt }];
    const view = views.get(document.id)!;
    rows.push([path, DOCUMENT_CATEGORY_LABELS[document.category], view.documentDate ?? "", document.originalFileName, String(document.sizeBytes), document.checksumSha256, toIsoDate(document.createdAt), view.links.map((l) => l.label).join(" | ")]);
  }
  const index = toCsv(["Fichier", "Catégorie", "Date du document", "Nom d'origine", "Taille (octets)", "Empreinte SHA-256", "Ajouté le", "Associé à"], rows);
  files["index.csv"] = [new TextEncoder().encode(index), { level: 6 }];
  const zip = Buffer.from(zipSync(files));
  await recordAudit({ action: "document.export", userId, companyId: access.company.id, metadata: { count, category: query.category ?? null }, ...meta });
  return { fileName: `documents-${toIsoDate(new Date())}.zip`, zip, count };
}
