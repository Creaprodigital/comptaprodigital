import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { getSetting } from "@/server/modules/admin/settings";
import { isStripeConfigured } from "./stripe";

/**
 * Situation d'un abonnement :
 *  - « trial » : essai en cours ;
 *  - « active » : abonnement payé ;
 *  - « grace » : paiement en échec, Stripe relance — l'accès reste complet, un bandeau prévient ;
 *  - « inactive » : essai terminé sans abonnement, abonnement résilié ou impayé.
 * Un compte inactif conserve l'accès en lecture et l'export de toutes ses données.
 */
export type Standing = "trial" | "active" | "grace" | "inactive";

export function standingOf(subscription: Pick<Subscription, "status" | "trialEndsAt"> | null, now = new Date()): Standing {
  if (!subscription) return "inactive";
  switch (subscription.status) {
    case "TRIALING":
      return subscription.trialEndsAt && subscription.trialEndsAt > now ? "trial" : "inactive";
    case "ACTIVE":
      return "active";
    case "PAST_DUE":
      return "grace";
    default:
      return "inactive";
  }
}

/** Correspondance des statuts Stripe avec ceux de la plateforme. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    // Essai terminé sans moyen de paiement (« paused ») ou première facture jamais réglée.
    default:
      return "EXPIRED";
  }
}

/** La restriction s'applique-t-elle ? (paramètre « billing.enforcement ») */
export async function enforcementActive(): Promise<boolean> {
  const mode = await getSetting("billing.enforcement");
  return mode === "on" || (mode === "auto" && isStripeConfigured());
}

/** Situation de l'abonnement du propriétaire d'une entreprise. */
export async function companyOwnerStanding(companyId: string): Promise<Standing> {
  const owner = await prisma.companyUser.findFirst({
    where: { companyId, status: "ACTIVE", role: { key: "OWNER" } },
    select: { user: { select: { subscription: { select: { status: true, trialEndsAt: true } } } } },
  });
  return standingOf(owner?.user.subscription ?? null);
}

/** L'entreprise est-elle en lecture seule faute d'abonnement actif de son propriétaire ? */
export async function isCompanyReadOnly(companyId: string): Promise<boolean> {
  if (!(await enforcementActive())) return false;
  return (await companyOwnerStanding(companyId)) === "inactive";
}

export async function isUserReadOnly(userId: string): Promise<boolean> {
  if (!(await enforcementActive())) return false;
  const subscription = await prisma.subscription.findUnique({ where: { userId }, select: { status: true, trialEndsAt: true } });
  return standingOf(subscription) === "inactive";
}
