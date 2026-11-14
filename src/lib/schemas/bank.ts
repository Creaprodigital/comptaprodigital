import { z } from "zod";
import Decimal from "decimal.js";
import { CATEGORY_KINDS, DOCUMENT_CATEGORIES, RULE_MATCH_TYPES } from "@/lib/bank";
import { decimalString, id, isoDate, isValidIban, optionalDecimal, optionalIsoDate, optionalText, text, type Loose } from "@/lib/schemas/invoicing";

/** Schémas de validation de la banque et des documents, partagés entre les formulaires et l'API. */

const optionalId = z
  .union([id, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : undefined));

const vatRate = optionalDecimal({ min: 0, max: 100, scale: 2, label: "Taux de TVA" });

export const bankAccountSchema = z.object({
  name: text(100).min(2, "Indiquez le nom du compte"),
  bankName: optionalText(100),
  iban: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v.replace(/\s/g, "").toUpperCase() : undefined))
    .refine((v) => v === undefined || isValidIban(v), "IBAN invalide"),
  bic: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v.replace(/\s/g, "").toUpperCase() : undefined))
    .refine((v) => v === undefined || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), "BIC invalide"),
  openingBalance: optionalDecimal({ scale: 2, label: "Solde d'ouverture" }),
  openingBalanceDate: optionalIsoDate,
});
export type BankAccountInput = Loose<z.infer<typeof bankAccountSchema>>;

export const manualTransactionSchema = z.object({
  bankAccountId: id,
  date: isoDate,
  label: text(255).min(2, "Indiquez un libellé"),
  direction: z.enum(["IN", "OUT"]),
  amount: decimalString({ scale: 2, label: "Montant" }).refine((v) => new Decimal(v).greaterThan(0), "Le montant doit être positif"),
  categoryId: optionalId,
  vatRate,
  notes: optionalText(2000),
});
export type ManualTransactionInput = Loose<z.infer<typeof manualTransactionSchema>>;

/** Mise à jour partielle : seules les propriétés présentes sont modifiées (`null` efface la valeur). */
export const transactionUpdateSchema = z.object({
  label: text(255).min(2, "Indiquez un libellé").optional(),
  notes: z.union([text(2000), z.null()]).optional(),
  categoryId: z.union([id, z.null()]).optional(),
  vatRate: z.union([decimalString({ min: 0, max: 100, scale: 2, label: "Taux de TVA" }), z.null()]).optional(),
  /** Opérations saisies à la main uniquement. */
  date: isoDate.optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  amount: decimalString({ scale: 2, label: "Montant" })
    .refine((v) => new Decimal(v).greaterThan(0), "Le montant doit être positif")
    .optional(),
});
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

export const bulkCategorizeSchema = z.object({
  ids: z.array(id).min(1, "Sélectionnez au moins une opération").max(200),
  categoryId: id,
  vatRate,
});

export const categorySchema = z.object({
  name: text(100).min(2, "Indiquez un nom"),
  kind: z.enum(CATEGORY_KINDS),
  accountNumber: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v.replace(/\s/g, "") : undefined))
    .refine((v) => v === undefined || /^\d{3,8}$/.test(v), "Numéro de compte : 3 à 8 chiffres"),
  color: z
    .union([z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
});
export type CategoryInput = Loose<z.infer<typeof categorySchema>>;

export const ruleSchema = z
  .object({
    name: text(100).min(2, "Indiquez un nom"),
    matchType: z.enum(RULE_MATCH_TYPES).default("CONTAINS"),
    pattern: text(255).min(2, "Indiquez au moins deux caractères"),
    direction: z
      .union([z.enum(["IN", "OUT"]), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : undefined)),
    amountMin: optionalDecimal({ min: 0, scale: 2, label: "Montant minimal" }),
    amountMax: optionalDecimal({ min: 0, scale: 2, label: "Montant maximal" }),
    categoryId: id,
    vatRate,
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !v.amountMin || !v.amountMax || new Decimal(v.amountMin).lessThanOrEqualTo(v.amountMax), {
    path: ["amountMax"],
    message: "Le montant maximal est inférieur au montant minimal",
  })
  .refine((v) => /[A-Za-z0-9À-ÿ]{2}/.test(v.pattern), { path: ["pattern"], message: "Le texte recherché doit contenir des lettres ou des chiffres" });
export type RuleInput = Loose<z.infer<typeof ruleSchema>>;

export const reconcileSchema = z.object({
  allocations: z
    .array(
      z.union([
        z.object({
          invoiceId: id,
          amount: decimalString({ scale: 2, label: "Montant" }).refine((v) => new Decimal(v).greaterThan(0), "Le montant doit être positif"),
        }),
        z.object({ paymentId: id }),
      ]),
    )
    .min(1, "Sélectionnez au moins une facture")
    .max(50),
});
export type ReconcileInput = z.infer<typeof reconcileSchema>;

const column = z.coerce.number().int().min(0).max(200);
export const csvMappingSchema = z
  .object({ date: column, label: column, amount: column.optional(), debit: column.optional(), credit: column.optional(), valueDate: column.optional(), labelExtra: column.optional() })
  .refine((v) => v.amount !== undefined || v.debit !== undefined || v.credit !== undefined, { path: ["amount"], message: "Indiquez la colonne du montant, ou les colonnes débit et crédit" });

export const transactionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  accountId: z.string().max(40).optional(),
  status: z.enum(["TO_REVIEW", "CATEGORIZED", "RECONCILED"]).optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  categoryId: z.string().max(40).optional(),
  flag: z.enum(["unjustified", "duplicates"]).optional(),
  from: optionalIsoDate,
  to: optionalIsoDate,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type TransactionsQuery = Partial<z.infer<typeof transactionsQuerySchema>>;

// --- Documents -------------------------------------------------------------------

export const LINKABLE_ENTITY_TYPES = ["BANK_TRANSACTION", "INVOICE", "QUOTE"] as const;

export const documentUpdateSchema = z.object({
  name: text(255).min(1, "Indiquez un nom"),
  category: z.enum(DOCUMENT_CATEGORIES),
  documentDate: optionalIsoDate,
});
export type DocumentUpdateInput = Loose<z.infer<typeof documentUpdateSchema>>;

export const documentLinkSchema = z.object({ entityType: z.enum(LINKABLE_ENTITY_TYPES), entityId: id });
export type DocumentLinkInput = z.infer<typeof documentLinkSchema>;

export const documentsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  link: z.enum(["linked", "unlinked"]).optional(),
  from: optionalIsoDate,
  to: optionalIsoDate,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type DocumentsQuery = Partial<z.infer<typeof documentsQuerySchema>>;

/** Champs accompagnant l'envoi d'un fichier (multipart). */
export const documentUploadFieldsSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  documentDate: optionalIsoDate,
  entityType: z.enum(LINKABLE_ENTITY_TYPES).optional(),
  entityId: id.optional(),
});
