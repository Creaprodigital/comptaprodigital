import { z } from "zod";
import Decimal from "decimal.js";
import { emailSchema } from "@/lib/schemas/auth";
import { isIsoDate } from "@/lib/dates";
import { isValidSiren, isValidSiret, normalizeDigits } from "@/lib/identifiers";

/** Schémas de validation de la facturation, partagés entre les formulaires et l'API. */

/** Rend facultatives les propriétés pouvant valoir `undefined` (plus commode pour construire une entrée dans le code). */
export type Loose<T> = { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] } & { [K in keyof T as undefined extends T[K] ? never : K]: T[K] };

export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Texte trop long")
    .regex(/^[^<>]*$/, "Caractères non autorisés");

export const optionalText = (max: number) =>
  z
    .union([text(max), z.null()])
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Nombre décimal saisi à la française ou à l'anglaise (« 1 234,56 » ou « 1234.56 »),
 * normalisé en chaîne « 1234.56 ». Jamais converti en flottant.
 */
export function decimalString(options: { min?: number; max?: number; scale?: number; label?: string } = {}) {
  const { min, max = 9_999_999_999, scale = 2, label = "Montant" } = options;
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[\s\u00a0\u202f]/g, "").replace(",", "."))
    .superRefine((v, ctx) => {
      if (!/^-?\d+(\.\d+)?$/.test(v)) {
        ctx.addIssue({ code: "custom", message: `${label} invalide` });
        return;
      }
      const value = new Decimal(v);
      if ((v.split(".")[1]?.length ?? 0) > scale) ctx.addIssue({ code: "custom", message: `${label} : ${scale} décimales au maximum` });
      else if (min !== undefined && value.lessThan(min)) ctx.addIssue({ code: "custom", message: `${label} trop petit` });
      else if (value.abs().greaterThan(max)) ctx.addIssue({ code: "custom", message: `${label} trop grand` });
    });
}

/** Décimal facultatif : chaîne vide, null ou absent → undefined. */
export function optionalDecimal(options: Parameters<typeof decimalString>[0]) {
  return z
    .union([z.literal(""), z.null(), decimalString(options)])
    .optional()
    .transform((v) => (v ? v : undefined));
}

export const isoDate = z.string().refine(isIsoDate, "Date invalide");
export const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : undefined));

export const id = z.string().min(1).max(40);

// --- Clients et fournisseurs --------------------------------------------------

export const customerSchema = z
  .object({
    type: z.enum(["COMPANY", "INDIVIDUAL"]).default("COMPANY"),
    name: text(191).min(1, "Le nom est requis"),
    contactName: optionalText(191),
    email: emailSchema.optional().or(z.literal("").transform(() => undefined)),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[0-9+().\s-]*$/, "Numéro de téléphone invalide")
      .optional()
      .transform((v) => (v ? v : undefined)),
    siren: z
      .string()
      .transform(normalizeDigits)
      .refine((v) => v === "" || isValidSiren(v), "Numéro SIREN invalide")
      .optional()
      .transform((v) => (v ? v : undefined)),
    siret: z
      .string()
      .transform(normalizeDigits)
      .refine((v) => v === "" || isValidSiret(v), "Numéro SIRET invalide")
      .optional()
      .transform((v) => (v ? v : undefined)),
    vatNumber: z
      .string()
      .transform((v) => v.replace(/\s/g, "").toUpperCase())
      .refine((v) => v === "" || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v), "Numéro de TVA intracommunautaire invalide")
      .optional()
      .transform((v) => (v ? v : undefined)),
    addressLine1: optionalText(191),
    addressLine2: optionalText(191),
    postalCode: z
      .string()
      .trim()
      .max(10, "Code postal trop long")
      .regex(/^[A-Za-z0-9 -]*$/, "Code postal invalide")
      .optional()
      .transform((v) => (v ? v : undefined)),
    city: optionalText(100),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Code pays sur deux lettres (ex. FR)")
      .default("FR"),
    paymentTermDays: z
      .union([z.literal(""), z.null(), z.coerce.number().int().min(0, "Délai invalide").max(120, "Délai maximal : 120 jours")])
      .optional()
      .transform((v) => (typeof v === "number" ? v : undefined)),
    notes: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (value.siren && value.siret && !value.siret.startsWith(value.siren)) {
      ctx.addIssue({ code: "custom", path: ["siret"], message: "Le SIRET ne correspond pas au SIREN" });
    }
  });
export type CustomerInput = Loose<z.infer<typeof customerSchema>>;

// --- Catalogue ----------------------------------------------------------------

export const productSchema = z.object({
  type: z.enum(["SERVICE", "GOOD"]).default("SERVICE"),
  reference: optionalText(60),
  name: text(191).min(1, "La désignation est requise"),
  description: optionalText(2000),
  unit: optionalText(30),
  unitPriceExclTax: decimalString({ min: 0, scale: 4, label: "Prix unitaire" }),
  vatRate: decimalString({ min: 0, max: 100, scale: 2, label: "Taux de TVA" }),
  isActive: z.boolean().default(true),
});
export type ProductInput = Loose<z.infer<typeof productSchema>>;

export const vatRateSchema = z.object({
  label: text(100).min(1, "Le libellé est requis"),
  rate: decimalString({ min: 0, max: 100, scale: 2, label: "Taux" }),
  legalNote: optionalText(255),
});

// --- Devis et factures --------------------------------------------------------

export const documentLineSchema = z.object({
  productId: z
    .union([id, z.literal(""), z.null()])
    .optional()
    .transform((v) => v || undefined),
  description: z.string().trim().min(1, "La désignation est requise").max(2000, "Désignation trop longue").regex(/^[^<>]*$/, "Caractères non autorisés"),
  quantity: decimalString({ scale: 4, label: "Quantité" }).refine((v) => new Decimal(v).greaterThan(0), "La quantité doit être positive"),
  unit: optionalText(30),
  unitPriceExclTax: decimalString({ scale: 4, label: "Prix unitaire" }),
  discountRate: decimalString({ min: 0, max: 100, scale: 2, label: "Remise" }).default("0"),
  vatRate: decimalString({ min: 0, max: 100, scale: 2, label: "Taux de TVA" }),
});
export type DocumentLineInput = Loose<z.infer<typeof documentLineSchema>>;

const documentBase = {
  customerId: id,
  subject: optionalText(255),
  notes: optionalText(4000),
  discountType: z.enum(["NONE", "PERCENT", "AMOUNT"]).default("NONE"),
  discountValue: decimalString({ min: 0, scale: 2, label: "Remise" }).default("0"),
  items: z.array(documentLineSchema).min(1, "Ajoutez au moins une ligne").max(200, "Trop de lignes"),
};

export const quoteSchema = z
  .object({
    ...documentBase,
    issueDate: isoDate,
    validUntil: optionalIsoDate,
    terms: optionalText(4000),
  })
  .superRefine((value, ctx) => {
    if (value.validUntil && value.validUntil < value.issueDate) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La date de validité précède la date du devis" });
    }
  });
export type QuoteInput = Loose<Omit<z.infer<typeof quoteSchema>, "items">> & { items: DocumentLineInput[] };

export const invoiceSchema = z
  .object({
    ...documentBase,
    issueDate: isoDate,
    dueDate: optionalIsoDate,
    serviceDate: optionalIsoDate,
    paymentTerms: optionalText(4000),
    operationCategory: z.enum(["SERVICES", "GOODS", "MIXED"]).default("SERVICES"),
  })
  .superRefine((value, ctx) => {
    if (value.dueDate && value.dueDate < value.issueDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "L'échéance précède la date d'émission" });
    }
  });
export type InvoiceInput = Loose<Omit<z.infer<typeof invoiceSchema>, "items">> & { items: DocumentLineInput[] };

export const quoteStatusSchema = z.object({ status: z.enum(["SENT", "ACCEPTED", "REJECTED", "DRAFT"]) });

export const convertQuoteSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("invoice") }),
  z.object({
    mode: z.literal("deposit"),
    percent: decimalString({ min: 1, max: 100, scale: 2, label: "Pourcentage d'acompte" }),
  }),
]);

export const creditNoteSchema = z.object({
  reason: text(255).min(3, "Indiquez le motif de l'avoir"),
  /** Avoir total si aucune ligne n'est précisée. */
  items: z.array(documentLineSchema).max(200).optional(),
});

export const paymentSchema = z.object({
  amount: decimalString({ scale: 2, label: "Montant" }).refine((v) => new Decimal(v).greaterThan(0), "Le montant doit être positif"),
  paidAt: isoDate,
  method: z.enum(["TRANSFER", "CARD", "CHECK", "CASH", "DIRECT_DEBIT", "OTHER"]).default("TRANSFER"),
  reference: optionalText(191),
  note: optionalText(255),
});
export type PaymentInput = Loose<z.infer<typeof paymentSchema>>;

export const sendDocumentSchema = z.object({
  to: emailSchema,
  subject: text(191).min(3, "L'objet est requis"),
  message: z.string().trim().min(1, "Le message est requis").max(4000, "Message trop long").regex(/^[^<>]*$/, "Caractères non autorisés"),
  copyToSelf: z.boolean().default(false),
});

export const recurringInvoiceSchema = z
  .object({
    customerId: id,
    label: text(191).min(1, "Le libellé est requis"),
    frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
    nextRunDate: isoDate,
    endDate: optionalIsoDate,
    autoIssue: z.boolean().default(false),
    autoSend: z.boolean().default(false),
    subject: optionalText(255),
    notes: optionalText(4000),
    operationCategory: z.enum(["SERVICES", "GOODS", "MIXED"]).default("SERVICES"),
    items: z.array(documentLineSchema).min(1, "Ajoutez au moins une ligne").max(200),
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.nextRunDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "La date de fin précède la première échéance" });
    }
    if (value.autoSend && !value.autoIssue) {
      ctx.addIssue({ code: "custom", path: ["autoSend"], message: "L'envoi automatique nécessite l'émission automatique" });
    }
  });
export type RecurringInvoiceInput = Loose<Omit<z.infer<typeof recurringInvoiceSchema>, "items">> & { items: DocumentLineInput[] };

export const recurringStatusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ENDED"]) });

// --- Paramètres de facturation --------------------------------------------------

export const billingSettingsSchema = z.object({
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "1 à 6 lettres ou chiffres"),
  quotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "1 à 6 lettres ou chiffres"),
  creditNotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "1 à 6 lettres ou chiffres"),
  defaultPaymentTermDays: z.coerce.number().int().min(0, "Délai invalide").max(60, "Le délai légal maximal est de 60 jours"),
  quoteValidityDays: z.coerce.number().int().min(1, "Durée invalide").max(365, "Durée maximale : 365 jours"),
  latePenaltyRate: optionalDecimal({ min: 0, max: 100, scale: 2, label: "Taux" }),
  earlyPaymentDiscountNote: optionalText(255),
  invoiceFooter: optionalText(1000),
  invoiceAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide").default("#2563EB"),
  rcsCity: optionalText(100),
  shareCapital: optionalDecimal({ min: 0, scale: 2, label: "Capital" }),
  iban: z
    .string()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || isValidIban(v), "IBAN invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  bic: z
    .string()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), "BIC invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  remindersEnabled: z.boolean().default(false),
  reminderDelaysDays: z
    .array(z.coerce.number().int().min(1, "Délai invalide").max(180, "Délai maximal : 180 jours"))
    .max(5, "Cinq relances au maximum")
    .default([7, 15, 30])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
});
export type BillingSettingsInput = Loose<z.infer<typeof billingSettingsSchema>>;

export const logoSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"], "Format accepté : PNG ou JPEG"),
  dataBase64: z.string().min(20, "Image vide").max(700_000, "Image trop volumineuse (500 Ko maximum)"),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(30).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  archived: z.enum(["true", "false"]).optional(),
});

/** Contrôle d'un IBAN par la clé modulo 97 (ISO 13616). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
