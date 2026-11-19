import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/server/env";

/**
 * Client de l'API Anthropic (Claude), uniquement côté serveur : la clé n'est jamais
 * transmise au navigateur. Sans ANTHROPIC_API_KEY, toutes les fonctions d'IA sont
 * désactivées et masquées de l'interface.
 */

let client: Anthropic | null | undefined;

export function getAnthropic(): Anthropic | null {
  if (client !== undefined) return client;
  const key = env().ANTHROPIC_API_KEY;
  // ANTHROPIC_BASE_URL (passerelle, faux serveur de test) est lu directement par le SDK.
  client = key ? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) : null;
  return client;
}

export function isAiConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return env().AI_MODEL;
}

/**
 * Paramètres communs : en cas de refus par les filtres de sécurité du modèle, l'API
 * relance automatiquement la requête sur un modèle de repli adapté (« fallbacks »).
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Réservé aux tests. */
export function resetAiClient() {
  client = undefined;
}

export { Anthropic };
