import Stripe from "stripe";
import { env } from "@/server/env";

/**
 * Client Stripe côté serveur. La clé secrète ne quitte jamais le serveur : le
 * paiement se fait sur les pages hébergées par Stripe (Checkout, portail client),
 * aucune donnée de carte ne transite par la plateforme.
 */

let client: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const config = env();
  if (!config.STRIPE_SECRET_KEY) {
    client = null;
    return client;
  }
  const base = config.STRIPE_API_BASE ? new URL(config.STRIPE_API_BASE) : null;
  client = new Stripe(config.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "ComptaPro Digital" },
    ...(base ? { host: base.hostname, port: base.port || (base.protocol === "https:" ? 443 : 80), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
  });
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY);
}

/** Mode de la clé configurée : test ou production (jamais la clé elle-même). */
export function stripeMode(): "test" | "live" | null {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return null;
  return key.includes("_live_") ? "live" : "test";
}

/** Réservé aux tests. */
export function resetStripeClient() {
  client = undefined;
}

export type { Stripe };
