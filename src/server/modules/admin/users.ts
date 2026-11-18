import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { getStripe } from "@/server/billing/stripe";
import { syncStripeSubscription } from "@/server/billing/service";
import { standingOf } from "@/server/billing/standing";
import { toMoneyString } from "@/lib/money";

/**
 * Comptes clients vus de l'administration : identité, abonnement, entreprises
 * (noms et statuts uniquement). Aucune donnée comptable ou financière d'entreprise.
 */

type Meta = { ip?: string | null; userAgent?: string | null };
const audit = (adminId: string, action: string, entityId: string, metadata: Prisma.InputJsonValue, meta: Meta = {}) =>
  recordAudit({ action: `admin.${action}`, userId: adminId, actorType: "SUPER_ADMIN", entityType: "User", entityId, metadata, ...meta });

export async function listUsers(filter: { q?: string; status?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where: Prisma.UserWhereInput = { status: { not: "DELETED" } };
  if (filter.status === "SUSPENDED") where.status = "SUSPENDED";
  if (filter.status === "ADMIN") where.isSuperAdmin = true;
  if (filter.q) where.OR = [{ email: { contains: filter.q } }, { firstName: { contains: filter.q } }, { lastName: { contains: filter.q } }];
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { subscription: { include: { plan: { select: { name: true } } } }, _count: { select: { memberships: { where: { status: "ACTIVE" } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 30,
      take: 30,
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: `${u.firstName} ${u.lastName}`,
      status: u.status,
      isSuperAdmin: u.isSuperAdmin,
      verified: u.emailVerifiedAt !== null,
      mfa: u.mfaEnabledAt !== null,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      companies: u._count.memberships,
      plan: u.subscription?.plan.name ?? null,
      subscriptionStatus: u.subscription?.status ?? null,
      standing: standingOf(u.subscription),
    })),
    total,
    page,
    pageSize: 30,
  };
}

export async function getUserAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: { include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 24 } } },
      memberships: { include: { company: { select: { id: true, name: true, status: true, siren: true } }, role: { select: { name: true } } } },
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }, supportTickets: true } },
    },
  });
  if (!user) throw errors.notFound("Compte introuvable.");
  const s = user.subscription;
  return {
    id: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    phone: user.phone,
    status: user.status,
    suspendedReason: user.suspendedReason,
    isSuperAdmin: user.isSuperAdmin,
    verified: user.emailVerifiedAt !== null,
    mfa: user.mfaEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    activeSessions: user._count.sessions,
    tickets: user._count.supportTickets,
    subscription: s
      ? {
          planKey: s.plan.key,
          planName: s.plan.name,
          status: s.status,
          standing: standingOf(s),
          interval: s.billingInterval,
          trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          priceAmount: s.priceAmount ? toMoneyString(s.priceAmount) : null,
          stripeCustomerId: s.stripeCustomerId,
          stripeSubscriptionId: s.stripeSubscriptionId,
          payments: s.payments.map((p) => ({ id: p.id, date: (p.paidAt ?? p.createdAt).toISOString(), amount: toMoneyString(p.amount), status: p.status, invoicePdfUrl: p.invoicePdfUrl })),
        }
      : null,
    companies: user.memberships.map((m) => ({ id: m.company.id, name: m.company.name, siren: m.company.siren, status: m.company.status, role: m.role.name, membership: m.status })),
  };
}

export async function setUserSuspended(adminId: string, userId: string, suspended: boolean, reason: string | null, meta: Meta = {}) {
  if (adminId === userId) throw errors.badRequest("SELF_ACTION", "Vous ne pouvez pas suspendre votre propre compte.");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === "DELETED") throw errors.notFound("Compte introuvable.");
  if (user.isSuperAdmin) throw errors.forbidden("Le compte d'un administrateur ne se suspend pas depuis l'interface.");
  if (suspended) {
    if (!reason || reason.trim().length < 10) throw errors.validation([{ path: "reason", message: "Indiquez le motif de la suspension (10 caractères au moins)" }]);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason.slice(0, 255) } }),
      // Les sessions ouvertes sont révoquées immédiatement.
      prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  } else {
    await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null } });
  }
  await audit(adminId, suspended ? "user_suspended" : "user_reactivated", userId, { reason }, meta);
}

/** Prolonge l'essai d'un compte sans abonnement Stripe en cours. */
export async function extendTrial(adminId: string, userId: string, days: number, reason: string, meta: Meta = {}) {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription) throw errors.notFound("Aucun abonnement pour ce compte.");
  if (subscription.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status)) {
    throw errors.conflict("STRIPE_MANAGED", "Cet abonnement est géré par Stripe : ajustez l'essai depuis le tableau de bord Stripe.");
  }
  const base = subscription.trialEndsAt && subscription.trialEndsAt > new Date() ? subscription.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + days * 86400_000);
  await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "TRIALING", trialEndsAt, trialReminderSentAt: null } });
  await audit(adminId, "trial_extended", userId, { days, reason, trialEndsAt: trialEndsAt.toISOString() }, meta);
}

/** Change la formule d'un compte sans abonnement Stripe (geste commercial, essai). */
export async function setPlanManually(adminId: string, userId: string, planKey: string, reason: string, meta: Meta = {}) {
  const [subscription, plan] = await Promise.all([prisma.subscription.findUnique({ where: { userId } }), prisma.subscriptionPlan.findUnique({ where: { key: planKey } })]);
  if (!subscription) throw errors.notFound("Aucun abonnement pour ce compte.");
  if (!plan) throw errors.validation([{ path: "planKey", message: "Formule introuvable" }]);
  if (subscription.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status)) {
    throw errors.conflict("STRIPE_MANAGED", "Cet abonnement est géré par Stripe : le titulaire change de formule depuis sa page Abonnement.");
  }
  await prisma.subscription.update({ where: { id: subscription.id }, data: { planId: plan.id } });
  await audit(adminId, "plan_set", userId, { planKey, reason }, meta);
}

/** Relit l'abonnement chez Stripe. */
export async function resyncFromStripe(adminId: string, userId: string, meta: Meta = {}) {
  const stripe = getStripe();
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!stripe || !subscription?.stripeSubscriptionId) throw errors.badRequest("NOT_STRIPE", "Aucun abonnement Stripe à synchroniser.");
  await syncStripeSubscription(await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId), userId);
  await audit(adminId, "subscription_resynced", userId, {}, meta);
}

export async function listSubscriptions(filter: { status?: string; plan?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where: Prisma.SubscriptionWhereInput = {};
  if (filter.status) where.status = filter.status as never;
  if (filter.plan) where.plan = { key: filter.plan };
  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({ where, include: { plan: { select: { name: true, monthlyPrice: true, yearlyPrice: true } }, user: { select: { id: true, email: true, firstName: true, lastName: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.subscription.count({ where }),
  ]);
  return {
    items: rows.map((s) => ({
      id: s.id,
      user: { id: s.user.id, email: s.user.email, name: `${s.user.firstName} ${s.user.lastName}` },
      plan: s.plan.name,
      status: s.status,
      interval: s.billingInterval,
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      amount: toMoneyString(s.priceAmount ?? (s.billingInterval === "YEARLY" ? s.plan.yearlyPrice : s.plan.monthlyPrice)),
      paymentFailedAt: s.paymentFailedAt?.toISOString() ?? null,
      stripe: Boolean(s.stripeSubscriptionId),
    })),
    total,
    page,
    pageSize: 30,
  };
}

export async function listPayments(filter: { status?: string; page?: number }) {
  const page = filter.page ?? 1;
  const where: Prisma.SubscriptionPaymentWhereInput = filter.status ? { status: filter.status } : {};
  const [rows, total] = await Promise.all([
    prisma.subscriptionPayment.findMany({ where, include: { subscription: { include: { user: { select: { id: true, email: true } }, plan: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.subscriptionPayment.count({ where }),
  ]);
  return {
    items: rows.map((p) => ({ id: p.id, date: (p.paidAt ?? p.createdAt).toISOString(), amount: toMoneyString(p.amount), currency: p.currency, status: p.status, user: p.subscription.user, plan: p.subscription.plan.name, invoicePdfUrl: p.invoicePdfUrl, hostedInvoiceUrl: p.hostedInvoiceUrl })),
    total,
    page,
    pageSize: 30,
  };
}
