import Decimal from "decimal.js";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { DocumentCategory, Prisma } from "@prisma/client";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { getDocumentContent, linkDocument } from "@/server/modules/documents/service";
import { listCategories } from "@/server/modules/bank/categories";
import { createPurchase } from "@/server/modules/purchases/service";
import { isValidSiren, normalizeDigits } from "@/lib/identifiers";
import { todayInParis } from "@/lib/dates";
import { FALLBACK_BETA } from "./client";
import { runAi } from "./service";

/**
 * Lecture d'un justificatif (PDF, JPEG, PNG) par Claude : type de document, fournisseur,
 * numéro, dates, montants et catégorie suggérée. Le résultat est une proposition :
 *  - il est contrôlé côté serveur (HT + TVA = TTC, dates, SIREN, catégorie existante) ;
 *  - il n'est utilisé qu'après vérification et correction éventuelle par l'utilisateur ;
 *  - la création d'une facture d'achat à partir de la lecture reste une action explicite.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

const DOCUMENT_TYPES = ["PURCHASE_INVOICE", "SALES_INVOICE", "RECEIPT", "BANK_STATEMENT", "TAX", "PAYROLL", "LEGAL", "OTHER"] as const;

/** Schéma imposé à la réponse du modèle (sortie structurée). Les montants sont des chaînes décimales. */
const ExtractionSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  supplierName: z.string().nullable(),
  supplierSiren: z.string().nullable(),
  supplierVatNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  issueDate: z.string().nullable().describe("Date d'émission au format AAAA-MM-JJ"),
  dueDate: z.string().nullable().describe("Date d'échéance au format AAAA-MM-JJ"),
  currency: z.string().nullable().describe("Code ISO 4217, ex. EUR"),
  totalExclTax: z.string().nullable().describe("Total hors taxes, chiffres et point décimal, ex. 1250.00"),
  totalVat: z.string().nullable(),
  totalInclTax: z.string().nullable(),
  vatLines: z.array(z.object({ rate: z.string(), base: z.string().nullable(), amount: z.string().nullable() })),
  label: z.string().nullable().describe("Objet de l'achat en quelques mots"),
  operationCategory: z.enum(["GOODS", "SERVICES", "MIXED"]).nullable(),
  suggestedCategoryId: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  remarks: z.array(z.string()).describe("Points d'attention pour la personne qui vérifie, en français"),
});
type RawExtraction = z.infer<typeof ExtractionSchema>;

export type Extraction = {
  documentType: (typeof DOCUMENT_TYPES)[number];
  supplierName: string | null;
  supplierSiren: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalExclTax: string | null;
  totalVat: string | null;
  totalInclTax: string | null;
  vatLines: Array<{ rate: string; base: string | null; amount: string | null }>;
  label: string | null;
  operationCategory: "GOODS" | "SERVICES" | "MIXED" | null;
  suggestedCategoryId: string | null;
  confidence: "low" | "medium" | "high";
  /** Remarques du modèle et anomalies détectées par les contrôles du serveur. */
  warnings: string[];
};

export type ExtractionState = {
  status: "NONE" | "PENDING" | "DONE" | "FAILED";
  extraction: Extraction | null;
  extractedAt: string | null;
  verifiedAt: string | null;
  model: string | null;
};

const SYSTEM_PROMPT = `Tu lis des justificatifs comptables d'entreprises françaises (factures, reçus, tickets, relevés, avis d'imposition) et tu en extrais les informations demandées pour pré-remplir une saisie, qui sera vérifiée par une personne avant tout usage.

Règles :
- Ne recopie que ce qui figure sur le document. Si une information est absente ou illisible, mets null : n'invente ni ne déduis jamais un numéro, une date ou un montant.
- Montants : chiffres avec un point décimal et deux décimales (ex. 1250.00), sans espace ni symbole monétaire.
- Dates au format AAAA-MM-JJ.
- documentType : PURCHASE_INVOICE pour une facture reçue d'un fournisseur ; SALES_INVOICE si l'émetteur est l'entreprise elle-même ; RECEIPT pour un ticket de caisse ou un reçu ; sinon le type le plus proche.
- supplierName, supplierSiren et supplierVatNumber désignent l'émetteur du document, jamais l'entreprise destinataire.
- suggestedCategoryId : identifiant exact pris dans la liste des catégories fournie, ou null si aucune ne convient.
- remarks : signale ce qui mérite une vérification (montant manuscrit, document partiel, plusieurs taux de TVA, devise étrangère, document qui n'est pas une facture…). Rédige en français.`;

function toState(row: { ocrStatus: string; ocrData: Prisma.JsonValue | null; ocrVerifiedAt: Date | null }): ExtractionState {
  const data = (row.ocrData ?? null) as { extraction?: Extraction; extractedAt?: string; model?: string } | null;
  return {
    status: row.ocrStatus as ExtractionState["status"],
    extraction: data?.extraction ?? null,
    extractedAt: data?.extractedAt ?? null,
    verifiedAt: row.ocrVerifiedAt?.toISOString() ?? null,
    model: data?.model ?? null,
  };
}

const AMOUNT = /^-?\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanAmount(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\s  €]/g, "").replace(",", ".");
  return AMOUNT.test(normalized) ? new Decimal(normalized).toFixed(2) : null;
}

function cleanDate(value: string | null): string | null {
  if (!value || !DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

/** Contrôles déterministes appliqués à la réponse du modèle. Exporté pour les tests. */
export function normalizeExtraction(raw: RawExtraction, categoryIds: Set<string>, today = todayInParis()): Extraction {
  const warnings = [...raw.remarks.filter((r) => r.trim()).map((r) => r.trim().slice(0, 300))];
  const totalExclTax = cleanAmount(raw.totalExclTax);
  const totalVat = cleanAmount(raw.totalVat);
  let totalInclTax = cleanAmount(raw.totalInclTax);
  for (const [label, rawValue, value] of [["HT", raw.totalExclTax, totalExclTax], ["TVA", raw.totalVat, totalVat], ["TTC", raw.totalInclTax, totalInclTax]] as const) {
    if (rawValue && !value) warnings.push(`Montant ${label} illisible (« ${rawValue.slice(0, 30)} ») : à saisir.`);
  }
  if (totalExclTax && totalVat && totalInclTax && !new Decimal(totalExclTax).plus(totalVat).equals(totalInclTax)) {
    warnings.push(`Les montants ne concordent pas : ${totalExclTax} HT + ${totalVat} TVA ≠ ${totalInclTax} TTC.`);
  }
  if (totalExclTax && totalVat && !totalInclTax) totalInclTax = new Decimal(totalExclTax).plus(totalVat).toFixed(2);

  const issueDate = cleanDate(raw.issueDate);
  const dueDate = cleanDate(raw.dueDate);
  if (raw.issueDate && !issueDate) warnings.push("Date de la facture illisible : à saisir.");
  if (issueDate && issueDate > today) warnings.push("La date lue est dans le futur : vérifiez-la.");
  if (issueDate && dueDate && dueDate < issueDate) warnings.push("L'échéance lue précède la date de la facture.");

  let supplierSiren = raw.supplierSiren ? normalizeDigits(raw.supplierSiren).slice(0, 9) : null;
  if (supplierSiren && !isValidSiren(supplierSiren)) {
    warnings.push(`Le SIREN lu (${raw.supplierSiren}) n'est pas valide.`);
    supplierSiren = null;
  }
  const supplierVatNumber = raw.supplierVatNumber ? raw.supplierVatNumber.replace(/\s/g, "").toUpperCase() : null;
  const currency = (raw.currency ?? "EUR").toUpperCase().slice(0, 3);
  if (currency !== "EUR") warnings.push(`Document en devise étrangère (${currency}) : la conversion en euros est à faire manuellement.`);

  const suggestedCategoryId = raw.suggestedCategoryId && categoryIds.has(raw.suggestedCategoryId) ? raw.suggestedCategoryId : null;
  return {
    documentType: raw.documentType,
    supplierName: raw.supplierName?.trim().slice(0, 191) || null,
    supplierSiren,
    supplierVatNumber: supplierVatNumber && /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(supplierVatNumber) ? supplierVatNumber : null,
    invoiceNumber: raw.invoiceNumber?.trim().slice(0, 100) || null,
    issueDate,
    dueDate,
    currency,
    totalExclTax,
    totalVat,
    totalInclTax,
    vatLines: raw.vatLines.slice(0, 10).map((l) => ({ rate: l.rate.replace(",", ".").replace("%", "").trim().slice(0, 6), base: cleanAmount(l.base), amount: cleanAmount(l.amount) })),
    label: raw.label?.trim().slice(0, 255) || null,
    operationCategory: raw.operationCategory,
    suggestedCategoryId,
    confidence: raw.confidence,
    warnings,
  };
}

/** Taille maximale d'une image transmise au modèle. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function getExtraction(access: CompanyAccess, documentId: string): Promise<ExtractionState> {
  const row = await access.db.document.findFirst({ where: { id: documentId, deletedAt: null }, select: { ocrStatus: true, ocrData: true, ocrVerifiedAt: true } });
  if (!row) throw errors.notFound("Document introuvable.");
  return toState(row);
}

export async function extractDocument(access: CompanyAccess, userId: string, documentId: string, meta: Meta = {}): Promise<ExtractionState> {
  const { document, bytes } = await getDocumentContent(access, userId, documentId);
  const isPdf = document.mimeType === "application/pdf";
  if (!isPdf && bytes.length > MAX_IMAGE_BYTES) throw errors.badRequest("FILE_TOO_LARGE", "Image trop volumineuse pour la lecture automatique (5 Mo au maximum) : utilisez un PDF ou une image plus légère.");
  const categories = (await listCategories(access.company.id)).filter((c) => c.kind === "EXPENSE" || c.kind === "INCOME");
  const categoryIds = new Set(categories.map((c) => c.id));

  await access.db.document.update({ where: { id: document.id }, data: { ocrStatus: "PENDING" } });
  try {
    const extraction = await runAi(access, userId, "DOCUMENT_EXTRACTION", async (client, model) => {
      const data = bytes.toString("base64");
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              isPdf
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
                : { type: "image", source: { type: "base64", media_type: document.mimeType as "image/jpeg" | "image/png", data } },
              {
                type: "text",
                text: [
                  `Entreprise destinataire : ${access.company.name}${access.company.siren ? ` (SIREN ${access.company.siren})` : ""}.`,
                  "Catégories disponibles (identifiant — nom — nature) :",
                  ...categories.map((c) => `${c.id} — ${c.name} — ${c.kind === "EXPENSE" ? "dépense" : "recette"}`),
                  "Extrais les informations de ce document.",
                ].join("\n"),
              },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        return { result: null, usage: [response.usage], refused: response.stop_reason === "refusal" };
      }
      return { result: normalizeExtraction(response.parsed_output, categoryIds), usage: [response.usage] };
    });
    if (!extraction) throw new AppError(502, "AI_UNREADABLE", "Le document n'a pas pu être lu. Saisissez les informations manuellement.");
    const row = await access.db.document.update({
      where: { id: document.id },
      data: {
        ocrStatus: "DONE",
        ocrVerifiedAt: null,
        ocrData: { extraction, extractedAt: new Date().toISOString(), model: "claude" } as unknown as Prisma.InputJsonValue,
        suggestedCategory: extraction.documentType as DocumentCategory,
      },
    });
    await recordAudit({ action: "document.ai_extraction", userId, companyId: access.company.id, entityType: "Document", entityId: document.id, metadata: { detail: "Lecture automatique du document (à vérifier)" }, ...meta });
    return toState(row);
  } catch (error) {
    await access.db.document.update({ where: { id: document.id }, data: { ocrStatus: "FAILED" } }).catch(() => undefined);
    throw error;
  }
}

/** Champs vérifiés (et corrigés si besoin) par l'utilisateur. */
export const verifiedExtractionSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  supplierName: z.string().trim().max(191).nullable().optional().transform((v) => v || null),
  invoiceNumber: z.string().trim().max(100).nullable().optional().transform((v) => v || null),
  issueDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  dueDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  totalExclTax: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, "Montant invalide"), z.literal(""), z.null()]).optional().transform((v) => v || null),
  totalVat: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, "Montant invalide"), z.literal(""), z.null()]).optional().transform((v) => v || null),
  label: z.string().trim().max(255).nullable().optional().transform((v) => v || null),
  categoryId: z.string().max(40).nullable().optional().transform((v) => v || null),
  operationCategory: z.enum(["GOODS", "SERVICES", "MIXED"]).default("SERVICES"),
});
export type VerifiedExtraction = z.infer<typeof verifiedExtractionSchema>;

/** Enregistre la lecture vérifiée et classe le document en conséquence. */
export async function verifyExtraction(access: CompanyAccess, userId: string, documentId: string, input: VerifiedExtraction, meta: Meta = {}): Promise<ExtractionState> {
  const row = await access.db.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!row) throw errors.notFound("Document introuvable.");
  const state = toState(row);
  if (!state.extraction) throw errors.conflict("NO_EXTRACTION", "Ce document n'a pas encore été lu.");
  const corrected: Extraction = {
    ...state.extraction,
    documentType: input.documentType,
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    totalExclTax: input.totalExclTax ? new Decimal(input.totalExclTax).toFixed(2) : null,
    totalVat: input.totalVat ? new Decimal(input.totalVat).toFixed(2) : null,
    totalInclTax: input.totalExclTax ? new Decimal(input.totalExclTax).plus(input.totalVat ?? "0").toFixed(2) : null,
    label: input.label,
    suggestedCategoryId: input.categoryId,
    operationCategory: input.operationCategory,
  };
  const changed = (["documentType", "supplierName", "invoiceNumber", "issueDate", "dueDate", "totalExclTax", "totalVat", "label", "suggestedCategoryId"] as const).filter((k) => state.extraction![k] !== corrected[k]);
  const updated = await access.db.document.update({
    where: { id: row.id },
    data: {
      ocrVerifiedAt: new Date(),
      ocrData: { ...(row.ocrData as object), extraction: corrected } as Prisma.InputJsonValue,
      // Le classement n'est modifié qu'après vérification humaine.
      category: input.documentType as DocumentCategory,
      ...(input.issueDate && !row.documentDate ? { documentDate: new Date(`${input.issueDate}T00:00:00Z`) } : {}),
    },
  });
  await recordAudit({ action: "document.ai_extraction_verified", userId, companyId: access.company.id, entityType: "Document", entityId: row.id, metadata: { detail: changed.length ? `Lecture vérifiée et corrigée (${changed.join(", ")})` : "Lecture vérifiée sans correction" }, ...meta });
  return toState(updated);
}

/**
 * Crée la facture d'achat correspondant à une lecture vérifiée et y associe le document.
 * Le fournisseur est retrouvé (SIREN, n° de TVA ou nom) ou créé.
 */
export async function createPurchaseFromDocument(access: CompanyAccess, userId: string, documentId: string, meta: Meta = {}) {
  const row = await access.db.document.findFirst({ where: { id: documentId, deletedAt: null }, include: { links: true } });
  if (!row) throw errors.notFound("Document introuvable.");
  const state = toState(row);
  const e = state.extraction;
  if (!e || !state.verifiedAt) throw errors.conflict("EXTRACTION_NOT_VERIFIED", "Vérifiez d'abord les informations lues sur le document.");
  if (row.links.some((l) => l.entityType === "PURCHASE")) throw errors.conflict("ALREADY_LINKED", "Ce document est déjà associé à une facture d'achat.");
  const missing = [!e.issueDate && "date", !e.totalExclTax && "montant HT", !e.suggestedCategoryId && "catégorie"].filter(Boolean);
  if (missing.length) throw errors.validation([{ path: "extraction", message: `Complétez la lecture avant de créer l'achat : ${missing.join(", ")}.` }]);

  let supplierId: string | undefined;
  if (e.supplierName || e.supplierSiren || e.supplierVatNumber) {
    const or: Prisma.SupplierWhereInput[] = [];
    if (e.supplierSiren) or.push({ siren: e.supplierSiren });
    if (e.supplierVatNumber) or.push({ vatNumber: e.supplierVatNumber });
    if (e.supplierName) or.push({ name: e.supplierName });
    const existing = await access.db.supplier.findFirst({ where: { OR: or, archivedAt: null }, select: { id: true } });
    supplierId = existing?.id;
    if (!supplierId && e.supplierName) {
      const created = await access.db.supplier.create({ data: { companyId: access.company.id, name: e.supplierName, siren: e.supplierSiren, vatNumber: e.supplierVatNumber } });
      await recordAudit({ action: "supplier.create", userId, companyId: access.company.id, entityType: "Supplier", entityId: created.id, metadata: { detail: "Fournisseur créé depuis la lecture d'un justificatif" }, ...meta });
      supplierId = created.id;
    }
  }
  const purchase = await createPurchase(
    access,
    userId,
    {
      supplierId,
      reference: e.invoiceNumber ?? undefined,
      label: e.label ?? `Facture ${e.supplierName ?? ""}`.trim(),
      issueDate: e.issueDate!,
      dueDate: e.dueDate ?? undefined,
      categoryId: e.suggestedCategoryId!,
      operationCategory: e.operationCategory ?? "SERVICES",
      supplierVatOnDebits: false,
      totalExclTax: e.totalExclTax!,
      totalVat: e.totalVat ?? "0",
    },
    meta,
  );
  await linkDocument(access, userId, row.id, { entityType: "PURCHASE", entityId: purchase.id }, meta);
  return purchase;
}
