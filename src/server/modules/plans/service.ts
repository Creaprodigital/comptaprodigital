import { AppError } from "@/server/http/errors";
import type { SubscriptionPlan } from "@prisma/client";
import { prisma } from "@/server/db";

export type PlanLimits = {
  /** Nombre maximal d'entreprises détenues (null = illimité). */
  maxCompanies: number | null;
  /** Nombre maximal de membres par entreprise, propriétaire inclus (null = illimité). */
  maxMembers: number | null;
  /** Modules fonctionnels inclus dans la formule. */
  modules: string[];
  /** Requêtes d'IA par entreprise et par mois (null = illimité ; sans effet si le module « ai » n'est pas inclus). */
  aiRequestsPerMonth: number | null;
};

export type PublicPlan = {
  key: string;
  name: string;
  tagline: string | null;
  monthlyPrice: string;
  yearlyPrice: string;
  currency: string;
  trialDays: number;
  features: string[];
  limits: PlanLimits;
  isFeatured: boolean;
};

export function parsePlanLimits(plan: Pick<SubscriptionPlan, "limits">): PlanLimits {
  const raw = (plan.limits ?? {}) as Partial<PlanLimits>;
  return {
    maxCompanies: typeof raw.maxCompanies === "number" ? raw.maxCompanies : null,
    maxMembers: typeof raw.maxMembers === "number" ? raw.maxMembers : null,
    modules: Array.isArray(raw.modules) ? raw.modules.filter((m): m is string => typeof m === "string") : [],
    aiRequestsPerMonth: typeof raw.aiRequestsPerMonth === "number" ? raw.aiRequestsPerMonth : null,
  };
}

export function toPublicPlan(plan: SubscriptionPlan): PublicPlan {
  return {
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    monthlyPrice: plan.monthlyPrice.toFixed(2),
    yearlyPrice: plan.yearlyPrice.toFixed(2),
    currency: plan.currency,
    trialDays: plan.trialDays,
    features: Array.isArray(plan.features) ? plan.features.filter((f): f is string => typeof f === "string") : [],
    limits: parsePlanLimits(plan),
    isFeatured: plan.isFeatured,
  };
}

/** Formules actives, telles que configurées en base (modifiables depuis l'administration). */
export async function listActivePlans(): Promise<PublicPlan[]> {
  const plans = await prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return plans.map(toPublicPlan);
}

/** Limites applicables à un compte, d'après son abonnement. */
export async function getUserPlanLimits(userId: string): Promise<{ planKey: string; planName: string; limits: PlanLimits } | null> {
  const subscription = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
  if (!subscription) return null;
  return { planKey: subscription.plan.key, planName: subscription.plan.name, limits: parsePlanLimits(subscription.plan) };
}

/**
 * Indique si la formule du propriétaire de l'entreprise inclut un module
 * (ex. « invoicing-advanced » pour les acomptes et les factures récurrentes).
 */
export async function companyHasModule(companyId: string, moduleKey: string): Promise<boolean> {
  const owner = await prisma.companyUser.findFirst({
    where: { companyId, status: "ACTIVE", role: { key: "OWNER" } },
    select: { userId: true },
  });
  if (!owner) return false;
  const plan = await getUserPlanLimits(owner.userId);
  return plan?.limits.modules.includes(moduleKey) ?? false;
}

const MODULE_NOTICES: Record<string, string> = {
  bank: "Le suivi bancaire est inclus à partir de la formule Pro.",
  documents: "La gestion documentaire est incluse à partir de la formule Pro.",
  accounting: "La comptabilité en partie double est incluse à partir de la formule Pro.",
  vat: "Le suivi et la préparation des déclarations de TVA sont inclus à partir de la formule Pro.",
  ai: "L'assistant IA est inclus à partir de la formule Pro.",
};

/** Refuse l'accès à un module que la formule de l'entreprise n'inclut pas. */
export async function requireModule(companyId: string, moduleKey: string): Promise<void> {
  if (!(await companyHasModule(companyId, moduleKey))) {
    throw new AppError(403, "PLAN_FEATURE_UNAVAILABLE", MODULE_NOTICES[moduleKey] ?? "Cette fonctionnalité n'est pas incluse dans votre formule.");
  }
}
