import { z } from "zod";

/** Schémas de validation partagés entre les formulaires et l'API. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(191, "Adresse e-mail trop longue")
  .pipe(z.email("Adresse e-mail invalide"));

/** Politique alignée sur la recommandation CNIL : 12 caractères, 4 familles de caractères. */
export const passwordSchema = z
  .string()
  .min(12, "Le mot de passe doit contenir au moins 12 caractères")
  .max(128, "Le mot de passe ne peut pas dépasser 128 caractères")
  .regex(/[a-z]/, "Le mot de passe doit contenir une minuscule")
  .regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule")
  .regex(/\d/, "Le mot de passe doit contenir un chiffre")
  .regex(/[^A-Za-z0-9]/, "Le mot de passe doit contenir un caractère spécial");

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} est requis`)
    .max(100, `${label} est trop long`)
    .regex(/^[^<>]*$/, "Caractères non autorisés");

export const PLAN_KEYS = ["STARTER", "PRO", "BUSINESS"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const registerSchema = z.object({
  firstName: nameSchema("Le prénom"),
  lastName: nameSchema("Le nom"),
  email: emailSchema,
  password: passwordSchema,
  plan: z.enum(PLAN_KEYS).default("PRO"),
  acceptTerms: z.literal(true, "Vous devez accepter les conditions générales"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis").max(128),
});

export const mfaLoginSchema = z.object({
  code: z.string().trim().min(6, "Code invalide").max(20, "Code invalide"),
});

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Le code comporte 6 chiffres"),
});

export const tokenSchema = z.object({
  token: z.string().min(20, "Lien invalide").max(200, "Lien invalide"),
});

export const emailOnlySchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20, "Lien invalide").max(200, "Lien invalide"),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Le mot de passe actuel est requis").max(128),
  newPassword: passwordSchema,
});

export const disableMfaSchema = z.object({
  password: z.string().min(1, "Le mot de passe est requis").max(128),
});

export const updateProfileSchema = z.object({
  firstName: nameSchema("Le prénom"),
  lastName: nameSchema("Le nom"),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\s-]*$/, "Numéro de téléphone invalide")
    .optional()
    .or(z.literal("")),
});
