import { z } from "zod";
import Decimal from "decimal.js";
import { emailSchema } from "@/lib/schemas/auth";
import { ACCOUNT_NUMBER_PATTERN } from "@/lib/accounting";
import { isValidSiren, normalizeDigits } from "@/lib/identifiers";
import { decimalString, id, isoDate, optionalIsoDate, optionalText, text, type Loose } from "@/lib/schemas/invoicing";

/** Schémas des achats, de la comptabilité et de la TVA, partagés entre les formulaires et l'API. */

// --- Fournisseurs et factures d'achat --------------------------------------------------

export const supplierSchema = z.object({
  name: text(191).min(1, "Le nom est requis"),
  contactName: optionalText(191),
  email: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(30).regex(/^[0-9+().\s-]*$/, "Numéro de téléphone invalide").optional().transform((v) => (v ? v : undefined)),
  siren: z
    .string()
    .transform(normalizeDigits)
    .refine((v) => v === "" || isValidSiren(v), "Numéro SIREN invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  vatNumber: z
    .string()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v), "Numéro de TVA intracommunautaire invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  addressLine1: optionalText(191),
  postalCode: z.string().trim().max(10).regex(/^[A-Za-z0-9 -]*$/, "Code postal invalide").optional().transform((v) => (v ? v : undefined)),
  city: optionalText(100),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Code pays sur deux lettres (ex. FR)").default("FR"),
  notes: optionalText(2000),
});
export type SupplierInput = Loose<z.infer<typeof supplierSchema>>;

const positiveOrZero = (label: string) => decimalString({ min: 0, scale: 2, label });

export const purchaseSchema = z
  .object({
    supplierId: z.union([id, z.literal(""), z.null()]).optional().transform((v) => (v ? v : undefined)),
    reference: optionalText(100),
    label: text(255).min(2, "Indiquez l'objet de l'achat"),
    issueDate: isoDate,
    dueDate: optionalIsoDate,
    categoryId: id,
    operationCategory: z.enum(["GOODS", "SERVICES", "MIXED"]).default("SERVICES"),
    supplierVatOnDebits: z.union([z.boolean(), z.enum(["on", "true", "false"])]).optional().transform((v) => v === true || v === "on" || v === "true"),
    totalExclTax: positiveOrZero("Montant HT").refine((v) => new Decimal(v).greaterThan(0), "Le montant HT doit être positif"),
    totalVat: positiveOrZero("Montant de TVA").default("0"),
    notes: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (value.dueDate && value.dueDate < value.issueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "L'échéance précède la date de la facture" });
    if (new Decimal(value.totalVat).greaterThan(new Decimal(value.totalExclTax))) ctx.addIssue({ code: "custom", path: ["totalVat"], message: "La TVA dépasse le montant hors taxes" });
  });
export type PurchaseInput = Loose<z.infer<typeof purchaseSchema>>;

export const purchasesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["TO_PAY", "PAID", "CANCELLED", "overdue"]).optional(),
  supplierId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const purchaseLinkSchema = z.object({ purchaseId: id });

// --- Comptabilité --------------------------------------------------------------------

const accountNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ""))
  .refine((v) => ACCOUNT_NUMBER_PATTERN.test(v), "Numéro de compte : de 3 à 10 chiffres, commençant par 1 à 7");

const amount = z
  .union([z.literal(""), z.null(), decimalString({ min: 0, scale: 2, label: "Montant" })])
  .optional()
  .transform((v) => (v ? v : "0"));

export const entryLineSchema = z.object({
  accountNumber,
  label: optionalText(255),
  debit: amount,
  credit: amount,
  auxiliaryNumber: z.union([z.string().trim().max(20).regex(/^[A-Za-z0-9_-]*$/, "Compte auxiliaire invalide"), z.null()]).optional().transform((v) => (v ? v : undefined)),
  auxiliaryLabel: optionalText(191),
});

export const manualEntrySchema = z.object({
  journalId: id,
  date: isoDate,
  label: text(255).min(2, "Indiquez un libellé"),
  pieceRef: optionalText(100),
  lines: z.array(entryLineSchema).min(2, "Une écriture comporte au moins deux lignes").max(200),
});

export const accountSchema = z.object({
  number: accountNumber,
  label: text(191).min(2, "Indiquez un intitulé"),
});

export const accountUpdateSchema = z.object({ label: text(191).min(2, "Indiquez un intitulé"), isActive: z.boolean().default(true) });

export const entriesQuerySchema = z.object({
  journalId: z.string().max(40).optional(),
  status: z.enum(["DRAFT", "VALIDATED"]).optional(),
  fiscalYearId: z.string().max(40).optional(),
  source: z.enum(["MANUAL", "INVOICE", "PAYMENT", "PURCHASE", "BANK_TRANSACTION", "DEPRECIATION", "CLOSING", "OPENING", "VAT_RETURN", "ASSET_DISPOSAL"]).optional(),
  from: optionalIsoDate,
  to: optionalIsoDate,
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const validateEntriesSchema = z.union([
  z.object({ ids: z.array(id).min(1).max(2000) }),
  z.object({ through: isoDate, journalId: id.optional() }),
]);

export const reverseEntrySchema = z.object({ date: optionalIsoDate });

export const lockPeriodSchema = z.object({ through: isoDate });

export const letteringSchema = z.object({ lineIds: z.array(id).min(2, "Sélectionnez au moins deux lignes").max(500) });

export const reportQuerySchema = z.object({
  fiscalYearId: z.string().max(40).optional(),
  from: optionalIsoDate,
  to: optionalIsoDate,
  account: z.string().trim().max(20).optional(),
  journalId: z.string().max(40).optional(),
  drafts: z.enum(["include", "exclude"]).optional(),
});

// --- Immobilisations -------------------------------------------------------------------

export const fixedAssetSchema = z
  .object({
    label: text(191).min(2, "Indiquez un intitulé"),
    assetAccountNumber: accountNumber.refine((v) => v.startsWith("2") && !v.startsWith("28"), "Compte d'immobilisation (classe 2, hors 28)"),
    acquisitionDate: isoDate,
    serviceDate: isoDate,
    cost: decimalString({ min: 0, scale: 2, label: "Valeur d'acquisition" }).refine((v) => new Decimal(v).greaterThan(0), "La valeur d'acquisition doit être positive"),
    residualValue: z.union([z.literal(""), z.null(), decimalString({ min: 0, scale: 2, label: "Valeur résiduelle" })]).optional().transform((v) => (v ? v : "0")),
    method: z.enum(["LINEAR", "DECLINING"]).default("LINEAR"),
    durationMonths: z.coerce.number().int().min(12, "Durée minimale : 12 mois").max(600, "Durée maximale : 50 ans"),
  })
  .superRefine((value, ctx) => {
    if (value.serviceDate < value.acquisitionDate) ctx.addIssue({ code: "custom", path: ["serviceDate"], message: "La mise en service précède l'acquisition" });
    if (new Decimal(value.residualValue).greaterThanOrEqualTo(value.cost)) ctx.addIssue({ code: "custom", path: ["residualValue"], message: "La valeur résiduelle doit être inférieure à la valeur d'acquisition" });
    if (value.method === "DECLINING" && value.durationMonths < 36) ctx.addIssue({ code: "custom", path: ["method"], message: "L'amortissement dégressif concerne les biens d'une durée d'au moins 3 ans" });
  });
export type FixedAssetInput = z.infer<typeof fixedAssetSchema>;

export const assetDisposalSchema = z.object({
  date: isoDate,
  salePrice: z.union([z.literal(""), z.null(), decimalString({ min: 0, scale: 2, label: "Prix de cession" })]).optional().transform((v) => (v ? v : "0")),
});

// --- TVA ---------------------------------------------------------------------------------

export const vatPeriodActionSchema = z.object({ action: z.enum(["prepare", "validate", "declare", "reopen"]) });
