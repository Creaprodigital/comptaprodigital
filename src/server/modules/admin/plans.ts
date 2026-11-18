import type { SubscriptionPlan } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { getStripe } from "@/server/billing/stripe";
import { parsePlanLimits } from "@/server/modules/plans/service";
import { dec } from "@/lib/money";
import type { PlanUpdateInput } from "@/lib/schemas/admin";

/**
 * Configuration des formules depuis l'administration. Les prix sont la source de
 * vérité de la plateforme ; dans Stripe, un prix est immuable : un changement de
 * tarif crée un nouveau prix et archive l'ancien. Les abonnés existants conservent
 * leur tarif jusqu'à ce qu'ils changent de formule.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

export function serializeAdminPlan(plan: SubscriptionPlan & { _count?: { subscriptions: number } }) {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    monthlyPrice: plan.monthlyPrice.toFixed(2),
    yearlyPrice: plan.yearlyPrice.toFixed(2),
    currency: plan.currency,
    trialDays: plan.trialDays,
    features: Array.isArray(plan.features) ? plan.features.filter((f): f is string => typeof f === "string") : [],
    limits: parsePlanLimits(plan),
    isActive: plan.isActive,
    isFeatured: plan.isFeatured,
    sortOrder: plan.sortOrder,
    stripeProductId: plan.stripeProductId,
    stripeMonthlyPriceId: plan.stripeMonthlyPriceId,
    stripeYearlyPriceId: plan.stripeYearlyPriceId,
    subscribers: plan._count?.subscriptions ?? 0,
  };
}
export type AdminPlan = ReturnType<typeof serializeAdminPlan>;

export async function listAdminPlans(): Promise<AdminPlan[]> {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } });
  return plans.map(serializeAdminPlan);
}

export async function updatePlan(adminId: string, planId: string, input: PlanUpdateInput, meta: Meta = {}) {
  const before = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!before) throw errors.notFound("Formule introuvable.");
  if (!input.isActive && before.isActive) {
    const others = await prisma.subscriptionPlan.count({ where: { isActive: true, id: { not: planId } } });
    if (others === 0) throw errors.conflict("LAST_PLAN", "Au moins une formule doit rester proposée.");
  }
  const plan = await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: {
      name: input.name,
      tagline: input.tagline,
      monthlyPrice: input.monthlyPrice,
      yearlyPrice: input.yearlyPrice,
      trialDays: input.trialDays,
      features: input.features,
      limits: input.limits,
      isActive: input.isActive,
      isFeatured: input.isFeatured,
      sortOrder: input.sortOrder,
    },
  });
  const priceChanged = !dec(before.monthlyPrice).equals(dec(plan.monthlyPrice)) || !dec(before.yearlyPrice).equals(dec(plan.yearlyPrice));
  await recordAudit({
    action: "admin.plan_update",
    userId: adminId,
    actorType: "SUPER_ADMIN",
    entityType: "SubscriptionPlan",
    entityId: plan.id,
    metadata: { key: plan.key, from: { monthly: before.monthlyPrice.toFixed(2), yearly: before.yearlyPrice.toFixed(2), trialDays: before.trialDays }, to: { monthly: plan.monthlyPrice.toFixed(2), yearly: plan.yearlyPrice.toFixed(2), trialDays: plan.trialDays } },
    ...meta,
  });
  // Les prix Stripe suivent le tarif dès qu'un produit a été synchronisé.
  const stripeSync = priceChanged || before.name !== plan.name || before.isActive !== plan.isActive ? await syncPlanToStripe(adminId, plan.id, meta).catch((error: Error) => ({ error: error.message })) : null;
  return { plan: serializeAdminPlan(plan), stripeSync };
}

/**
 * Crée ou met à jour le produit et les prix Stripe d'une formule. Les prix sont
 * marqués de métadonnées (planKey, interval) et identifiés par une clé
 * d'idempotence dérivée du montant, ce qui rend la synchronisation rejouable.
 */
export async function syncPlanToStripe(adminId: string, planId: string, meta: Meta = {}) {
  const stripe = getStripe();
  if (!stripe) throw errors.badRequest("STRIPE_NOT_CONFIGURED", "Stripe n'est pas configuré (STRIPE_SECRET_KEY).");
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw errors.notFound("Formule introuvable.");

  let productId = plan.stripeProductId;
  if (productId) {
    await stripe.products.update(productId, { name: plan.name, description: plan.tagline ?? undefined, active: plan.isActive, metadata: { planKey: plan.key } });
  } else {
    const product = await stripe.products.create({ name: plan.name, description: plan.tagline ?? undefined, active: plan.isActive, metadata: { planKey: plan.key } }, { idempotencyKey: `product-${plan.id}` });
    productId = product.id;
  }

  const ensurePrice = async (currentId: string | null, amount: string, interval: "month" | "year") => {
    const unitAmount = dec(amount).times(100).toDecimalPlaces(0).toNumber();
    if (currentId) {
      const current = await stripe.prices.retrieve(currentId);
      if (current.active && current.unit_amount === unitAmount && current.recurring?.interval === interval && current.currency === plan.currency.toLowerCase()) return currentId;
    }
    const price = await stripe.prices.create(
      { product: productId!, currency: plan.currency.toLowerCase(), unit_amount: unitAmount, recurring: { interval }, tax_behavior: "exclusive", metadata: { planKey: plan.key, interval } },
      { idempotencyKey: `price-${plan.id}-${interval}-${unitAmount}-${plan.currency}` },
    );
    // Prix immuable : l'ancien n'est plus proposé, les abonnés existants le conservent.
    if (currentId && currentId !== price.id) await stripe.prices.update(currentId, { active: false });
    return price.id;
  };

  const monthly = await ensurePrice(plan.stripeMonthlyPriceId, plan.monthlyPrice.toFixed(2), "month");
  const yearly = await ensurePrice(plan.stripeYearlyPriceId, plan.yearlyPrice.toFixed(2), "year");
  await prisma.subscriptionPlan.update({ where: { id: plan.id }, data: { stripeProductId: productId, stripeMonthlyPriceId: monthly, stripeYearlyPriceId: yearly } });
  await recordAudit({ action: "admin.plan_stripe_sync", userId: adminId, actorType: "SUPER_ADMIN", entityType: "SubscriptionPlan", entityId: plan.id, metadata: { productId, monthly, yearly }, ...meta });
  return { productId, monthlyPriceId: monthly, yearlyPriceId: yearly };
}
