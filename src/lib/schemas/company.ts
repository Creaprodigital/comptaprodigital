import { z } from "zod";
import { LEGAL_FORMS, TAX_REGIMES, VAT_EXIGIBILITIES, VAT_REGIMES, isMicroRegime, isTaxRegimeAllowed } from "@/config/legal";
import { ASSIGNABLE_ROLE_KEYS } from "@/server/rbac/permissions";
import { emailSchema } from "@/lib/schemas/auth";
import { isValidFrenchVatNumber, isValidSiren, isValidSiret, normalizeDigits } from "@/lib/identifiers";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Texte trop long")
    .regex(/^[^<>]*$/, "Caractères non autorisés")
    .optional()
    .transform((v) => (v ? v : undefined));

const baseCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "La raison sociale est requise")
    .max(191, "Raison sociale trop longue")
    .regex(/^[^<>]*$/, "Caractères non autorisés"),
  tradeName: optionalText(191),
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
    .refine((v) => v === "" || !v.startsWith("FR") || isValidFrenchVatNumber(v), "Numéro de TVA intracommunautaire invalide")
    .refine((v) => v === "" || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v), "Numéro de TVA intracommunautaire invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  nafCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(\d{2}\.?\d{2}[A-Z])?$/, "Code APE/NAF invalide (ex. 62.01Z)")
    .optional()
    .transform((v) => (v ? v : undefined)),
  legalForm: z.enum(LEGAL_FORMS, "Forme juridique requise"),
  taxRegime: z.enum(TAX_REGIMES, "Régime fiscal requis"),
  vatRegime: z.enum(VAT_REGIMES, "Régime de TVA requis"),
  vatExigibility: z.enum(VAT_EXIGIBILITIES).default("ENCAISSEMENTS"),
  fiscalYearStartMonth: z.coerce.number().int().min(1, "Mois invalide").max(12, "Mois invalide").default(1),
  addressLine1: optionalText(191),
  addressLine2: optionalText(191),
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, "Code postal invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
  city: optionalText(100),
  email: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\s-]*$/, "Numéro de téléphone invalide")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

type CompanyShape = z.infer<typeof baseCompanySchema>;

function checkCoherence(value: Partial<CompanyShape>, ctx: z.RefinementCtx) {
  if (value.legalForm && value.taxRegime && !isTaxRegimeAllowed(value.legalForm, value.taxRegime)) {
    ctx.addIssue({ code: "custom", path: ["taxRegime"], message: "Ce régime fiscal n'est pas proposé pour cette forme juridique" });
  }
  if (value.siren && value.siret && !value.siret.startsWith(value.siren)) {
    ctx.addIssue({ code: "custom", path: ["siret"], message: "Le SIRET ne correspond pas au SIREN" });
  }
  if (value.taxRegime && isMicroRegime(value.taxRegime) && value.fiscalYearStartMonth && value.fiscalYearStartMonth !== 1) {
    ctx.addIssue({ code: "custom", path: ["fiscalYearStartMonth"], message: "En micro-entreprise, l'exercice correspond à l'année civile" });
  }
}

export const createCompanySchema = baseCompanySchema.superRefine(checkCoherence);
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Le mois d'ouverture d'exercice n'est pas modifiable après création (les exercices existent déjà). */
export const updateCompanySchema = baseCompanySchema.omit({ fiscalYearStartMonth: true }).superRefine(checkCoherence);
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLE_KEYS, "Rôle invalide"),
});

export const updateMemberSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLE_KEYS, "Rôle invalide"),
});

export const companySearchSchema = z.object({
  q: z.string().trim().min(3, "Saisissez au moins 3 caractères").max(100),
});

export const activeCompanySchema = z.object({
  companyId: z.string().min(1).max(40),
});
