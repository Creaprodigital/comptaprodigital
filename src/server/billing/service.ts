import type { Prisma, Subscription, SubscriptionPlan } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { notify } from "@/server/modules/notifications/service";
import { parsePlanLimits, toPublicPlan, type PublicPlan } from "@/server/modules/plans/service";
import { getSetting } from "@/server/modules/admin/settings";
import { toMoneyString } from "@/lib/money";
import { getStripe, type Stripe } from "./stripe";
import { mapStripeStatus, standingOf, type Standing } from "./standing";

/**
 * Abonnements à la plateforme, adossés à Stripe.
 *
 *  - Essai : ouvert à l'inscription, sans moyen de paiement, pour la durée prévue par la formule.
 *  - Souscription : page de paiement hébergée par Stripe (Checkout), mensuelle ou annuelle ;
 *    la part d'essai restante est conservée.
 *  - Gestion : portail client Stripe (moyen de paiement, coordonnées de facturation).
 *  - Changement de formule (au prorata), résiliation en fin de période, reprise.
 *  - L'état local suit Stripe via les webhooks signés (voir webhooks.ts) ; Stripe fait foi.
 */

type Meta = { ip?: string | null; userAgent?: string | null };
export type Interval = "MONTHLY" | "YEARLY";

const centsToDecimal = (cents: number | null | undefined) => new Decimal(cents ?? 0).dividedBy(100).toFixed(2);
const fromUnix = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new AppError(503, "BILLING_UNAVAILABLE", "Le paiement en ligne n'est pas encore disponible. Contactez le support pour souscrire.");
  return stripe;
}

async function findSubscription(userId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true, user: { select: { id: true, email: true, firstName: true, lastName: true } } } });
  if (!subscription) throw errors.notFound("Aucun abonnement pour ce compte.");
  return subscription;
}

function priceIdFor(plan: SubscriptionPlan, interval: Interval): string {
  const id = interval === "YEARLY" ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;
  if (!id) throw new AppError(503, "PRICE_NOT_CONFIGURED", `La formule ${plan.name} n'est pas encore proposée en paiement ${interval === "YEARLY" ? "annuel" : "mensuel"}.`);
  return id;
}

async function activePlan(planKey: string): Promise<SubscriptionPlan> {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { key: planKey, isActive: true } });
  if (!plan) throw errors.validation([{ path: "plan", message: "Formule introuvable" }]);
  return plan;
}

/** Le compte respecte-t-il les limites d'une formule ? (entreprises détenues, membres par entreprise) */
export async function planFitProblems(userId: string, plan: Pick<SubscriptionPlan, "limits" | "name">): Promise<string[]> {
  const limits = parsePlanLimits(plan);
  const owned = await prisma.companyUser.findMany({
    where: { userId, status: "ACTIVE", role: { key: "OWNER" }, company: { status: { not: "ARCHIVED" } } },
    select: { company: { select: { name: true, _count: { select: { members: { where: { status: "ACTIVE" } } } } } } },
  });
  const problems: string[] = [];
  if (limits.maxCompanies !== null && owned.length > limits.maxCompanies) {
    problems.push(`La formule ${plan.name} permet ${limits.maxCompanies} entreprise${limits.maxCompanies > 1 ? "s" : ""} ; vous en détenez ${owned.length}. Archivez celles dont vous n'avez plus besoin.`);
  }
  if (limits.maxMembers !== null) {
    for (const { company } of owned) {
      if (company._count.members > limits.maxMembers) problems.push(`« ${company.name} » compte ${company._count.members} membres ; la formule ${plan.name} en permet ${limits.maxMembers}.`);
    }
  }
  return problems;
}

// --- Vue d'ensemble ---------------------------------------------------------------------

export type BillingOverview = {
  stripeEnabled: boolean;
  standing: Standing;
  subscription: {
    planKey: string;
    planName: string;
    status: Subscription["status"];
    interval: Interval;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    priceAmount: string | null;
    paymentFailedAt: string | null;
    managedByStripe: boolean;
  } | null;
  plans: Array<PublicPlan & { monthlyAvailable: boolean; yearlyAvailable: boolean; fitProblems: string[] }>;
  payments: Array<{ id: string; date: string; amount: string; currency: string; status: string; hostedInvoiceUrl: string | null; invoicePdfUrl: string | null }>;
};

export async function getBillingOverview(userId: string): Promise<BillingOverview> {
  const [subscription, plans] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId }, include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 36 } } }),
    prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const stripeEnabled = Boolean(getStripe());
  return {
    stripeEnabled,
    standing: standingOf(subscription),
    subscription: subscription
      ? {
          planKey: subscription.plan.key,
          planName: subscription.plan.name,
          status: subscription.status,
          interval: subscription.billingInterval,
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          priceAmount: subscription.priceAmount ? toMoneyString(subscription.priceAmount) : null,
          paymentFailedAt: subscription.paymentFailedAt?.toISOString() ?? null,
          managedByStripe: Boolean(subscription.stripeSubscriptionId) && !["CANCELED", "EXPIRED"].includes(subscription.status),
        }
      : null,
    plans: await Promise.all(
      plans.map(async (plan) => ({
        ...toPublicPlan(plan),
        monthlyAvailable: stripeEnabled && Boolean(plan.stripeMonthlyPriceId),
        yearlyAvailable: stripeEnabled && Boolean(plan.stripeYearlyPriceId),
        fitProblems: await planFitProblems(userId, plan),
      })),
    ),
    payments: (subscription?.payments ?? []).map((p) => ({
      id: p.id,
      date: (p.paidAt ?? p.createdAt).toISOString(),
      amount: toMoneyString(p.amount),
      currency: p.currency,
      status: p.status,
      hostedInvoiceUrl: p.hostedInvoiceUrl,
      invoicePdfUrl: p.invoicePdfUrl,
    })),
  };
}

// --- Souscription -------------------------------------------------------------------------

async function ensureCustomer(stripe: Stripe, subscription: Awaited<ReturnType<typeof findSubscription>>): Promise<string> {
  if (subscription.stripeCustomerId) return subscription.stripeCustomerId;
  const customer = await stripe.customers.create(
    { email: subscription.user.email, name: `${subscription.user.firstName} ${subscription.user.lastName}`, preferred_locales: ["fr"], metadata: { userId: subscription.userId } },
    { idempotencyKey: `customer-${subscription.userId}` },
  );
  await prisma.subscription.update({ where: { id: subscription.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** Ouvre une page de paiement Stripe pour souscrire une formule. */
export async function startCheckout(userId: string, planKey: string, interval: Interval, meta: Meta = {}): Promise<{ url: string }> {
  const stripe = requireStripe();
  const subscription = await findSubscription(userId);
  if (subscription.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status)) {
    throw errors.conflict("ALREADY_SUBSCRIBED", "Un abonnement est déjà en place : changez de formule plutôt que d'en souscrire un second.");
  }
  const plan = await activePlan(planKey);
  const problems = await planFitProblems(userId, plan);
  if (problems.length) throw errors.conflict("PLAN_LIMIT_EXCEEDED", problems.join(" "));
  const price = priceIdFor(plan, interval);
  const customer = await ensureCustomer(stripe, subscription);
  // L'essai restant est conservé (Stripe exige au moins 48 heures).
  const trialEnd = subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt.getTime() > Date.now() + 48 * 3600 * 1000 ? Math.floor(subscription.trialEndsAt.getTime() / 1000) : undefined;
  const base = env().APP_URL;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { userId, planKey: plan.key }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    locale: "fr",
    success_url: new URL("/app/abonnement?retour=succes&session_id={CHECKOUT_SESSION_ID}", base).toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    cancel_url: new URL("/app/abonnement?retour=annule", base).toString(),
  });
  if (!session.url) throw new AppError(502, "BILLING_ERROR", "Stripe n'a pas renvoyé de page de paiement.");
  await recordAudit({ action: "billing.checkout_started", userId, metadata: { plan: plan.key, interval }, ...meta });
  return { url: session.url };
}

/** Retour de la page de paiement : l'état est synchronisé sans attendre le webhook. */
export async function completeCheckout(userId: string, sessionId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== userId || !session.subscription) return;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  await syncStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId), userId);
}

/** Portail client Stripe : moyen de paiement, coordonnées et factures. */
export async function openBillingPortal(userId: string): Promise<{ url: string }> {
  const stripe = requireStripe();
  const subscription = await findSubscription(userId);
  if (!subscription.stripeCustomerId) throw errors.badRequest("NO_CUSTOMER", "Aucun moyen de paiement n'est encore enregistré : souscrivez d'abord une formule.");
  const session = await stripe.billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: new URL("/app/abonnement", env().APP_URL).toString(), locale: "fr" });
  return { url: session.url };
}

// --- Changement, résiliation ----------------------------------------------------------------

export async function changePlan(userId: string, planKey: string, interval: Interval, meta: Meta = {}): Promise<void> {
  const subscription = await findSubscription(userId);
  const plan = await activePlan(planKey);
  if (plan.id === subscription.planId && interval === subscription.billingInterval) return;
  const problems = await planFitProblems(userId, plan);
  if (problems.length) throw errors.conflict("PLAN_LIMIT_EXCEEDED", problems.join(" "));

  if (subscription.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status)) {
    const stripe = requireStripe();
    const current = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const item = current.items.data[0];
    const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceIdFor(plan, interval) }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { userId, planKey: plan.key },
    });
    await syncStripeSubscription(updated, userId);
  } else if (standingOf(subscription) === "trial") {
    // Pendant l'essai sans moyen de paiement, la formule d'essai peut être changée librement.
    await prisma.subscription.update({ where: { id: subscription.id }, data: { planId: plan.id, billingInterval: interval } });
  } else {
    throw errors.conflict("SUBSCRIPTION_REQUIRED", "Souscrivez une formule pour réactiver votre compte.");
  }
  await recordAudit({ action: "billing.plan_changed", userId, metadata: { from: subscription.plan.key, to: plan.key, interval }, ...meta });
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean, meta: Meta = {}): Promise<void> {
  const subscription = await findSubscription(userId);
  if (!subscription.stripeSubscriptionId || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status)) {
    throw errors.badRequest("NO_ACTIVE_SUBSCRIPTION", "Aucun abonnement payant en cours.");
  }
  const stripe = requireStripe();
  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: cancel });
  await syncStripeSubscription(updated, userId);
  await recordAudit({ action: cancel ? "billing.cancel_requested" : "billing.cancel_reverted", userId, ...meta });
}

// --- Synchronisation depuis Stripe -------------------------------------------------------------

async function planForPrice(price: Stripe.Price): Promise<{ plan: SubscriptionPlan; interval: Interval } | null> {
  const interval: Interval = price.recurring?.interval === "year" ? "YEARLY" : "MONTHLY";
  const byId = await prisma.subscriptionPlan.findFirst({ where: { OR: [{ stripeMonthlyPriceId: price.id }, { stripeYearlyPriceId: price.id }] } });
  if (byId) return { plan: byId, interval };
  const key = price.metadata?.planKey;
  const byKey = key ? await prisma.subscriptionPlan.findUnique({ where: { key } }) : null;
  return byKey ? { plan: byKey, interval } : null;
}

/** Aligne l'abonnement local sur l'abonnement Stripe. */
export async function syncStripeSubscription(stripeSubscription: Stripe.Subscription, hintUserId?: string): Promise<void> {
  const customerId = typeof stripeSubscription.customer === "string" ? stripeSubscription.customer : stripeSubscription.customer.id;
  const userId = hintUserId ?? stripeSubscription.metadata?.userId;
  const local = await prisma.subscription.findFirst({
    where: { OR: [{ stripeSubscriptionId: stripeSubscription.id }, { stripeCustomerId: customerId }, ...(userId ? [{ userId }] : [])] },
  });
  if (!local) {
    console.warn(`[stripe] abonnement ${stripeSubscription.id} sans compte correspondant`);
    return;
  }
  // Un ancien abonnement résilié ne remplace pas un abonnement plus récent.
  if (local.stripeSubscriptionId && local.stripeSubscriptionId !== stripeSubscription.id && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(local.status) && stripeSubscription.status === "canceled") return;

  const item = stripeSubscription.items.data[0];
  const mapping = item ? await planForPrice(item.price) : null;
  const status = mapStripeStatus(stripeSubscription.status);
  const data: Prisma.SubscriptionUncheckedUpdateInput = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    status,
    trialEndsAt: fromUnix(stripeSubscription.trial_end) ?? (status === "TRIALING" ? local.trialEndsAt : null),
    currentPeriodStart: fromUnix(item?.current_period_start),
    currentPeriodEnd: fromUnix(item?.current_period_end),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    canceledAt: fromUnix(stripeSubscription.canceled_at ?? stripeSubscription.ended_at),
    ...(mapping ? { planId: mapping.plan.id, billingInterval: mapping.interval } : {}),
    ...(item?.price.unit_amount != null ? { priceAmount: centsToDecimal(item.price.unit_amount) } : {}),
    ...(status === "ACTIVE" || status === "TRIALING" ? { paymentFailedAt: null } : {}),
  };
  await prisma.subscription.update({ where: { id: local.id }, data });
  if (local.status !== status) {
    await recordAudit({ action: "billing.status_changed", userId: local.userId, actorType: "SYSTEM", metadata: { from: local.status, to: status, stripeSubscriptionId: stripeSubscription.id } });
  }
}

/** Enregistre une facture d'abonnement Stripe (historique des paiements). */
export async function recordStripeInvoice(invoice: Stripe.Invoice, outcome: "paid" | "failed" | "updated"): Promise<void> {
  if (!invoice.id) return;
  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof parentSubscription === "string" ? parentSubscription : parentSubscription?.id;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const local = await prisma.subscription.findFirst({
    where: { OR: [...(stripeSubscriptionId ? [{ stripeSubscriptionId }] : []), ...(customerId ? [{ stripeCustomerId: customerId }] : [])] },
    include: { user: { select: { id: true, email: true, firstName: true } } },
  });
  if (!local) return;
  const status = outcome === "failed" ? "failed" : (invoice.status ?? "open");
  const amount = centsToDecimal(outcome === "paid" ? invoice.amount_paid : invoice.amount_due);
  await prisma.subscriptionPayment.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: { subscriptionId: local.id, stripeInvoiceId: invoice.id, amount, currency: (invoice.currency ?? "eur").toUpperCase(), status, paidAt: fromUnix(invoice.status_transitions?.paid_at), hostedInvoiceUrl: invoice.hosted_invoice_url ?? null, invoicePdfUrl: invoice.invoice_pdf ?? null },
    update: { amount, status, paidAt: fromUnix(invoice.status_transitions?.paid_at), hostedInvoiceUrl: invoice.hosted_invoice_url ?? null, invoicePdfUrl: invoice.invoice_pdf ?? null },
  });
  if (outcome === "paid") {
    await prisma.subscription.update({ where: { id: local.id }, data: { paymentFailedAt: null } });
  }
  if (outcome === "failed") {
    await prisma.subscription.update({ where: { id: local.id }, data: { paymentFailedAt: new Date() } });
    await notify(local.user.id, { type: "billing.payment_failed", title: "Échec du paiement de votre abonnement", body: "Mettez à jour votre moyen de paiement pour conserver l'accès complet à votre compte.", link: "/app/abonnement" });
    await sendMail(mailTemplates.paymentFailed(local.user.email, local.user.firstName, amount)).catch((error) => console.error("[stripe] e-mail d'échec de paiement", error));
    await recordAudit({ action: "billing.payment_failed", userId: local.user.id, actorType: "SYSTEM", metadata: { invoice: invoice.id, amount } });
  }
}

// --- Tâche quotidienne -----------------------------------------------------------------------

/** Rappels de fin d'essai et clôture des essais terminés sans souscription. */
export async function runTrialJobs(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const days = await getSetting("billing.trial_reminder_days");
  const soon = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const toRemind = await prisma.subscription.findMany({
    where: { status: "TRIALING", stripeSubscriptionId: null, trialReminderSentAt: null, trialEndsAt: { gt: now, lte: soon } },
    include: { user: { select: { id: true, email: true, firstName: true, status: true } }, plan: { select: { name: true } } },
  });
  let reminded = 0;
  for (const s of toRemind) {
    if (s.user.status !== "ACTIVE" || !s.trialEndsAt) continue;
    await notify(s.user.id, { type: "billing.trial_ending", title: "Votre essai se termine bientôt", body: `Souscrivez la formule ${s.plan.name} pour continuer à modifier vos données.`, link: "/app/abonnement" });
    await sendMail(mailTemplates.trialEnding(s.user.email, s.user.firstName, s.plan.name, s.trialEndsAt)).catch((error) => console.error("[abonnements] rappel d'essai", error));
    await prisma.subscription.update({ where: { id: s.id }, data: { trialReminderSentAt: now } });
    reminded++;
  }
  const expired = await prisma.subscription.updateMany({ where: { status: "TRIALING", stripeSubscriptionId: null, trialEndsAt: { lte: now } }, data: { status: "EXPIRED" } });
  return { reminded, expired: expired.count };
}
