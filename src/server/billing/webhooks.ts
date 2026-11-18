import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { getStripe, type Stripe } from "./stripe";
import { recordStripeInvoice, syncStripeSubscription } from "./service";

/**
 * Webhooks Stripe.
 *  - La signature (en-tête Stripe-Signature) est vérifiée sur le corps brut avec
 *    STRIPE_WEBHOOK_SECRET ; un appel non signé ou altéré est refusé.
 *  - Chaque événement n'est traité qu'une fois (table stripe_events) ; un échec de
 *    traitement libère l'événement pour que Stripe le renvoie.
 *  - Pour les abonnements, l'état est relu chez Stripe : l'ordre d'arrivée des
 *    événements n'a pas d'importance.
 */

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.finalized",
  "invoice.voided",
  "invoice.marked_uncollectible",
] as const;

export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const stripe = getStripe();
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) throw new AppError(503, "BILLING_UNAVAILABLE", "Stripe n'est pas configuré.");
  if (!signature) throw new AppError(400, "INVALID_SIGNATURE", "Signature absente.");
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret, 300);
  } catch {
    throw new AppError(400, "INVALID_SIGNATURE", "Signature invalide.");
  }
}

async function refreshSubscription(subscriptionId: string, hintUserId?: string | null) {
  const stripe = getStripe()!;
  await syncStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId), hintUserId ?? undefined);
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) return;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      await refreshSubscription(subscriptionId, session.client_reference_id);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const subscription = event.data.object;
      // Un abonnement supprimé n'est plus récupérable sous sa forme vivante : l'objet de l'événement fait foi.
      if (event.type === "customer.subscription.deleted") await syncStripeSubscription(subscription);
      else await refreshSubscription(subscription.id, subscription.metadata?.userId);
      return;
    }
    case "invoice.paid":
      await recordStripeInvoice(event.data.object, "paid");
      return;
    case "invoice.payment_failed":
      await recordStripeInvoice(event.data.object, "failed");
      return;
    case "invoice.finalized":
    case "invoice.voided":
    case "invoice.marked_uncollectible":
      await recordStripeInvoice(event.data.object, "updated");
      return;
    default:
      return;
  }
}

export async function processWebhook(rawBody: string, signature: string | null): Promise<{ received: true; duplicate?: boolean; ignored?: boolean }> {
  const event = verifyWebhook(rawBody, signature);
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { received: true, ignored: true };
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { received: true, duplicate: true };
    throw error;
  }
  try {
    await handle(event);
  } catch (error) {
    // Libère l'événement : Stripe le renverra et il sera retraité.
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    throw error;
  }
  return { received: true };
}
