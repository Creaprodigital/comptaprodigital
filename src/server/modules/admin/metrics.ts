import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { dec, toMoneyString, ZERO } from "@/lib/money";

/**
 * Indicateurs de l'activité SaaS.
 *  - MRR : somme, sur les abonnements payants (actifs ou en délai de grâce), du montant
 *    mensuel facturé — le prix annuel est ramené au mois. Le prix réellement appliqué par
 *    Stripe est utilisé lorsqu'il est connu, sinon le tarif de la formule.
 *  - ARR : MRR × 12.
 *  - Encaissements : factures d'abonnement payées, par mois.
 */

export function monthlyAmount(sub: { billingInterval: "MONTHLY" | "YEARLY"; priceAmount: Decimal.Value | null; plan: { monthlyPrice: Decimal.Value; yearlyPrice: Decimal.Value } }): Decimal {
  if (sub.billingInterval === "YEARLY") return dec(sub.priceAmount ?? sub.plan.yearlyPrice).dividedBy(12);
  return dec(sub.priceAmount ?? sub.plan.monthlyPrice);
}

export async function saasMetrics(now = new Date()) {
  const monthAgo = new Date(now.getTime() - 30 * 86400_000);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [paying, statusCounts, plans, payments, signups, churned, users, companies, openTickets, errors24h] = await Promise.all([
    prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } }, select: { billingInterval: true, priceAmount: true, planId: true, status: true, plan: { select: { monthlyPrice: true, yearlyPrice: true } } } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, key: true, name: true } }),
    prisma.subscriptionPayment.findMany({ where: { status: "paid", paidAt: { gte: yearStart } }, select: { amount: true, paidAt: true } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.subscription.count({ where: { status: "CANCELED", canceledAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { status: { not: "DELETED" } } }),
    prisma.company.count({ where: { status: { not: "ARCHIVED" } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.applicationError.count({ where: { createdAt: { gte: new Date(now.getTime() - 86400_000) } } }),
  ]);
  const mrr = paying.reduce((acc, s) => acc.plus(monthlyAmount(s)), ZERO);
  const byPlan = plans.map((plan) => {
    const subs = paying.filter((s) => s.planId === plan.id);
    return { key: plan.key, name: plan.name, subscribers: subs.length, mrr: toMoneyString(subs.reduce((acc, s) => acc.plus(monthlyAmount(s)), ZERO).toDecimalPlaces(2)) };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    const total = payments.filter((p) => p.paidAt?.toISOString().startsWith(key)).reduce((acc, p) => acc.plus(dec(p.amount)), ZERO);
    return { month: key, revenue: toMoneyString(total) };
  });
  const count = (status: string) => statusCounts.find((s) => s.status === status)?._count._all ?? 0;
  return {
    mrr: toMoneyString(mrr.toDecimalPlaces(2)),
    arr: toMoneyString(mrr.times(12).toDecimalPlaces(2)),
    payingSubscribers: paying.length,
    pastDue: paying.filter((s) => s.status === "PAST_DUE").length,
    trialing: count("TRIALING"),
    canceled30d: churned,
    signups30d: signups,
    users,
    companies,
    openTickets,
    errors24h,
    byPlan,
    revenueByMonth: months,
    revenue12m: toMoneyString(payments.reduce((acc, p) => acc.plus(dec(p.amount)), ZERO)),
  };
}
