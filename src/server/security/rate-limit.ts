import { prisma } from "@/server/db";
import { AppError } from "@/server/http/errors";
import { sha256Hex } from "@/server/security/crypto";

export type RateLimitRule = {
  /** Nom fonctionnel de la limite (ex. « auth.login »). */
  name: string;
  /** Nombre maximal de requêtes dans la fenêtre. */
  limit: number;
  windowSeconds: number;
};

/**
 * Limitation de débit à fenêtre fixe, stockée en base : elle reste valable
 * après un redémarrage et entre plusieurs instances de l'application.
 *
 * L'incrément est atomique (INSERT … ON DUPLICATE KEY UPDATE).
 */
export async function consumeRateLimit(rule: RateLimitRule, subject: string): Promise<{ allowed: boolean; remaining: number }> {
  // La clé est hachée : aucune adresse IP ni adresse e-mail en clair dans la table.
  const key = `${rule.name}:${sha256Hex(subject).slice(0, 40)}`;

  await prisma.$executeRaw`
    INSERT INTO rate_limit_counters (\`key\`, \`count\`, \`windowStart\`)
    VALUES (${key}, 1, NOW(3))
    ON DUPLICATE KEY UPDATE
      \`count\` = IF(\`windowStart\` < NOW(3) - INTERVAL ${rule.windowSeconds} SECOND, 1, \`count\` + 1),
      \`windowStart\` = IF(\`windowStart\` < NOW(3) - INTERVAL ${rule.windowSeconds} SECOND, NOW(3), \`windowStart\`)
  `;

  const counter = await prisma.rateLimitCounter.findUnique({ where: { key } });
  const count = counter?.count ?? 1;
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count) };
}

export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const { allowed } = await consumeRateLimit(rule, subject);
  if (!allowed) {
    throw new AppError(429, "RATE_LIMITED", "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.");
  }
}

/** Purge des compteurs expirés (à appeler depuis une tâche planifiée). */
export async function purgeExpiredRateLimits(olderThanSeconds = 86_400): Promise<number> {
  return prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE \`windowStart\` < NOW(3) - INTERVAL ${olderThanSeconds} SECOND`;
}

export const RATE_LIMITS = {
  login: { name: "auth.login", limit: 20, windowSeconds: 15 * 60 },
  loginPerEmail: { name: "auth.login.email", limit: 10, windowSeconds: 15 * 60 },
  register: { name: "auth.register", limit: 5, windowSeconds: 60 * 60 },
  mfaVerify: { name: "auth.mfa", limit: 8, windowSeconds: 10 * 60 },
  emailToken: { name: "auth.email-token", limit: 5, windowSeconds: 60 * 60 },
  passwordReset: { name: "auth.password-reset", limit: 5, windowSeconds: 60 * 60 },
  contact: { name: "contact", limit: 5, windowSeconds: 60 * 60 },
  companySearch: { name: "insee.search", limit: 30, windowSeconds: 60 },
  invitations: { name: "members.invite", limit: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
