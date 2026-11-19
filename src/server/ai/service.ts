import type { AiFeature } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { companyHasModule, getUserPlanLimits } from "@/server/modules/plans/service";
import { Anthropic, aiModel, getAnthropic, isAiConfigured } from "./client";

/**
 * Règles communes à toutes les fonctions d'IA :
 *  - la plateforme doit être configurée (clé d'API) et la formule inclure le module « ai » ;
 *  - l'entreprise doit avoir activé l'assistant (consentement explicite : ses données sont
 *    transmises à Anthropic, sous-traitant, pour le traitement de la requête) ;
 *  - un quota mensuel de requêtes s'applique par entreprise ;
 *  - chaque appel est journalisé (jetons, durée, issue), sans conserver de contenu ;
 *  - une réponse de l'IA n'est jamais appliquée d'elle-même : elle est présentée comme une
 *    proposition que l'utilisateur vérifie, corrige, accepte ou rejette.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

export type AiStatus = {
  /** Clé d'API présente sur le serveur. */
  configured: boolean;
  /** Module inclus dans la formule du titulaire. */
  included: boolean;
  /** Activé par l'entreprise. */
  enabled: boolean;
  enabledAt: string | null;
  quota: { used: number; limit: number | null };
  /** Utilisable maintenant (toutes les conditions réunies et quota non atteint). */
  usable: boolean;
};

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function ownerLimits(companyId: string) {
  const owner = await prisma.companyUser.findFirst({ where: { companyId, status: "ACTIVE", role: { key: "OWNER" } }, select: { userId: true } });
  return owner ? getUserPlanLimits(owner.userId) : null;
}

export async function aiStatus(company: { id: string; aiEnabledAt: Date | null }): Promise<AiStatus> {
  const [included, plan, used] = await Promise.all([
    companyHasModule(company.id, "ai"),
    ownerLimits(company.id),
    prisma.aiUsage.count({ where: { companyId: company.id, createdAt: { gte: monthStart() } } }),
  ]);
  const limit = plan?.limits.aiRequestsPerMonth ?? null;
  const configured = isAiConfigured();
  const enabled = company.aiEnabledAt !== null;
  return { configured, included, enabled, enabledAt: company.aiEnabledAt?.toISOString() ?? null, quota: { used, limit }, usable: configured && included && enabled && (limit === null || used < limit) };
}

/** Active ou désactive l'assistant pour l'entreprise (titulaire ou administrateur de l'entreprise). */
export async function setAiEnabled(access: CompanyAccess, userId: string, enabled: boolean, meta: Meta = {}) {
  if (access.roleKey !== "OWNER" && access.roleKey !== "COMPANY_ADMIN") throw errors.forbidden("Seul le titulaire ou un administrateur de l'entreprise peut activer l'assistant IA.");
  if (enabled && !(await companyHasModule(access.company.id, "ai"))) throw new AppError(403, "PLAN_FEATURE_UNAVAILABLE", "L'assistant IA est inclus à partir de la formule Pro.");
  const company = await prisma.company.update({ where: { id: access.company.id }, data: enabled ? { aiEnabledAt: new Date(), aiEnabledById: userId } : { aiEnabledAt: null, aiEnabledById: null } });
  await recordAudit({ action: enabled ? "ai.enabled" : "ai.disabled", userId, companyId: company.id, entityType: "Company", entityId: company.id, ...meta });
  return aiStatus(company);
}

/** Vérifie qu'une requête d'IA est permise et retourne le client. */
export async function assertAiUsable(access: CompanyAccess): Promise<Anthropic> {
  const status = await aiStatus(access.company);
  const client = getAnthropic();
  if (!status.configured || !client) throw new AppError(503, "AI_NOT_CONFIGURED", "L'assistant IA n'est pas disponible sur cette plateforme.");
  if (!status.included) throw new AppError(403, "PLAN_FEATURE_UNAVAILABLE", "L'assistant IA est inclus à partir de la formule Pro.");
  if (!status.enabled) throw new AppError(403, "AI_DISABLED", "L'assistant IA n'est pas activé pour cette entreprise (Paramètres de l'entreprise).");
  if (status.quota.limit !== null && status.quota.used >= status.quota.limit) {
    throw new AppError(429, "AI_QUOTA_REACHED", `Le quota mensuel de ${status.quota.limit} requêtes d'IA est atteint. Il sera renouvelé le 1er du mois prochain.`);
  }
  return client;
}

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined;

export class AiRefusalError extends AppError {
  constructor() {
    super(422, "AI_REFUSED", "L'assistant n'a pas pu traiter cette demande. Reformulez-la ou effectuez l'opération manuellement.");
  }
}

/**
 * Exécute un appel d'IA : contrôles préalables, mesure, journal d'usage, traduction des erreurs.
 * `fn` reçoit le client et le modèle, et retourne son résultat avec l'usage cumulé des réponses.
 */
export async function runAi<T>(
  access: CompanyAccess,
  userId: string,
  feature: AiFeature,
  fn: (client: Anthropic, model: string) => Promise<{ result: T; usage: Usage[]; refused?: boolean }>,
): Promise<T> {
  const client = await assertAiUsable(access);
  const model = aiModel();
  const started = Date.now();
  const log = (status: "OK" | "REFUSED" | "ERROR", usage: Usage[] = []) =>
    prisma.aiUsage
      .create({
        data: {
          companyId: access.company.id,
          userId,
          feature,
          model,
          status,
          inputTokens: usage.reduce((n, u) => n + (u?.input_tokens ?? 0), 0),
          outputTokens: usage.reduce((n, u) => n + (u?.output_tokens ?? 0), 0),
          cacheReadTokens: usage.reduce((n, u) => n + (u?.cache_read_input_tokens ?? 0), 0),
          durationMs: Date.now() - started,
        },
      })
      .catch((error) => console.error("[ai] journal d'usage", error));
  try {
    const { result, usage, refused } = await fn(client, model);
    await log(refused ? "REFUSED" : "OK", usage);
    if (refused) throw new AiRefusalError();
    return result;
  } catch (error) {
    if (error instanceof AiRefusalError) throw error;
    await log("ERROR");
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      throw new AppError(503, "AI_UNAVAILABLE", "Le service d'IA est momentanément indisponible. Réessayez dans quelques instants.");
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[ai] erreur de l'API", error.status, error.message);
      throw new AppError(502, "AI_ERROR", "Le service d'IA a renvoyé une erreur. Réessayez ou effectuez l'opération manuellement.");
    }
    throw error;
  }
}
