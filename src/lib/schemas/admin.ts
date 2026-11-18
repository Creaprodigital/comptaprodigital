import { z } from "zod";
import { decimalString } from "@/lib/schemas/invoicing";

/** Schémas des formulaires de l'administration. */

export const PLAN_MODULES = [
  { key: "dashboard", label: "Tableau de bord" },
  { key: "invoicing", label: "Devis et factures" },
  { key: "invoicing-advanced", label: "Acomptes, avoirs avancés, factures récurrentes" },
  { key: "customers", label: "Clients et produits" },
  { key: "accounting", label: "Comptabilité" },
  { key: "vat", label: "TVA" },
  { key: "bank", label: "Banque et rapprochement" },
  { key: "documents", label: "Gestion documentaire" },
  { key: "automation", label: "Automatisations avancées" },
  { key: "exports", label: "Exports comptables" },
  { key: "priority-support", label: "Support prioritaire" },
] as const;

const optionalLimit = z.union([z.null(), z.literal(""), z.coerce.number().int().min(1).max(1000)]).transform((v) => (v === "" || v === null ? null : v));

export const planUpdateSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(60),
  tagline: z.string().trim().max(160).nullable().optional().transform((v) => v || null),
  monthlyPrice: decimalString({ min: 0, scale: 2, max: 100_000, label: "Prix mensuel" }),
  yearlyPrice: decimalString({ min: 0, scale: 2, max: 1_000_000, label: "Prix annuel" }),
  trialDays: z.coerce.number().int().min(0, "Durée d'essai invalide").max(90, "90 jours au maximum"),
  features: z.array(z.string().trim().min(1).max(160)).max(20, "20 arguments au maximum"),
  limits: z.object({
    maxCompanies: optionalLimit,
    maxMembers: optionalLimit,
    modules: z.array(z.enum(PLAN_MODULES.map((m) => m.key) as [string, ...string[]])).min(1, "Au moins un module"),
  }),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100),
});
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().max(255).nullable().optional() });

export const suspendSchema = z.object({ suspended: z.boolean(), reason: z.string().trim().max(255).nullable().optional() });
export const companyStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().max(255).nullable().optional() });

export const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend_trial"), days: z.coerce.number().int().min(1).max(90), reason: z.string().trim().min(5, "Motif requis").max(255) }),
  z.object({ action: z.literal("set_plan"), planKey: z.string().min(1).max(32), reason: z.string().trim().min(5, "Motif requis").max(255) }),
  z.object({ action: z.literal("resync") }),
]);

export const accessGrantSchema = z.object({
  reason: z.string().trim().min(20, "Justifiez l'accès (20 caractères au moins)").max(500),
  hours: z.coerce.number().int().min(1).max(72),
});

const optionalDate = z
  .union([z.literal(""), z.null(), z.string().max(40)])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Date invalide" });
      return z.NEVER;
    }
    return date;
  });

export const announcementSchema = z.object({
  title: z.string().trim().min(3, "Titre trop court").max(160),
  body: z.string().trim().min(3, "Message trop court").max(2000),
  level: z.enum(["INFO", "WARNING", "CRITICAL"]),
  startsAt: optionalDate,
  endsAt: optionalDate,
  isActive: z.boolean(),
});

export const settingUpdateSchema = z.object({ key: z.string().min(1).max(64), value: z.unknown() });

export const adminTicketUpdateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

export const testEmailSchema = z.object({ to: z.email("Adresse e-mail invalide").max(254) });

export const pageQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(30).optional(),
  plan: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const auditQuery = z.object({
  action: z.string().trim().max(80).optional(),
  actorType: z.enum(["USER", "SUPER_ADMIN", "SYSTEM"]).optional(),
  companyId: z.string().max(40).optional(),
  userId: z.string().max(40).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  format: z.enum(["json", "csv"]).optional(),
});
export type AuditQuery = z.infer<typeof auditQuery>;
