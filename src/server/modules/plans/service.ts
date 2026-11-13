import type { SubscriptionPlan } from "@prisma/client";
import { prisma } from "@/server/db";

export type PlanLimits = {
  /** Nombre maximal d'entreprises détenues (null = illimité). */
  maxCompanies: number | null;
  /** Nombre maximal de membres par entreprise, propriétaire inclus (null = illimité). */
  maxMembers: number | null;
  /** Modules fonctionnels inclus dans la formule. */
  modules: string[];
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
