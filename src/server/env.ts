import { z } from "zod";

/**
 * Variables d'environnement, validées au premier accès (et non à l'import, pour
 * que `next build` fonctionne sans secrets). Aucune de ces valeurs ne doit être
 * importée depuis un composant client.
 */

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
    APP_URL: z.url("APP_URL doit être une URL absolue (ex. https://app.exemple.fr)"),
    APP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY doit contenir 32 octets encodés en base64"),

    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default("ComptaPro Digital <no-reply@localhost>"),
    /** Destinataire des messages du formulaire de contact. */
    CONTACT_EMAIL: z.string().optional(),

    /** Clé d'API Sirene (portail api.insee.fr). Sans clé, l'annuaire public des entreprises est utilisé. */
    INSEE_API_KEY: z.string().optional(),

    /** Stockage des documents : disque local (volume du serveur) ou stockage objet compatible S3. */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default(".storage"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Adressage « chemin » (MinIO, la plupart des offres compatibles S3) plutôt que par sous-domaine. */
    S3_FORCE_PATH_STYLE: booleanString.default(true),
    /** Abonnements : clé secrète Stripe (sk_test_… ou sk_live_…) et secret de signature des webhooks (whsec_…). */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    /** Réservé aux tests : adresse d'un faux serveur Stripe (interdit en production). */
    STRIPE_API_BASE: z.url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.SMTP_HOST) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST est requis en production (vérification d'e-mail, réinitialisation de mot de passe)",
      });
    }
    if (value.NODE_ENV === "production" && value.STRIPE_API_BASE) {
      ctx.addIssue({ code: "custom", path: ["STRIPE_API_BASE"], message: "STRIPE_API_BASE est réservé aux tests" });
    }
    if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET && value.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["STRIPE_WEBHOOK_SECRET"], message: "STRIPE_WEBHOOK_SECRET est requis lorsque Stripe est configuré" });
    }
    if (value.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} est requis lorsque STORAGE_DRIVER vaut « s3 »` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Réservé aux tests. */
export function resetEnvCache() {
  cached = undefined;
}
