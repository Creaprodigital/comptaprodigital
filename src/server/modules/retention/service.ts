import { prisma } from "@/server/db";

/**
 * Politique de conservation appliquée chaque jour (tâche quotidienne). Les durées sont
 * publiées dans la politique de confidentialité et dans docs/SECURITE.md.
 * Ne sont jamais purgées ici : les pièces et écritures comptables (dix ans, Code de commerce)
 * et les factures. Le journal d'audit est conservé six ans (douze mois pour les connexions).
 */
export const RETENTION_DAYS = {
  /** Jetons de vérification d'e-mail et de réinitialisation, utilisés ou expirés. */
  verificationTokens: 7,
  /** Invitations acceptées, révoquées ou expirées. */
  invitations: 90,
  /** Erreurs applicatives et rapports CSP. */
  applicationErrors: 90,
  /** Événements Stripe déjà traités (protection contre les doublons de webhooks). */
  stripeEvents: 90,
  /** Parcours de connexion bancaire terminés ou expirés (jeton à usage unique). */
  bankConnectSessions: 2,
  /** Notifications lues. */
  readNotifications: 180,
  /** Suggestions de l'IA déjà traitées. */
  decidedAiSuggestions: 180,
  /** Journal d'usage de l'IA (suivi des coûts, quotas). */
  aiUsage: 400,
  /** Journal des connexions (actions « auth.* ») : douze mois. */
  connectionLogs: 365,
  /** Autres entrées du journal d'audit (modifications, accès) : six ans, délai de prescription de droit commun majoré. */
  auditLogs: 6 * 365,
} as const;

const before = (now: Date, days: number) => new Date(now.getTime() - days * 86400_000);

export async function runRetentionPurges(now = new Date()) {
  const [tokens, invitations, appErrors, stripeEvents, connectSessions, notifications, suggestions, aiUsage, connections, audit] = await Promise.all([
    prisma.verificationToken.deleteMany({ where: { OR: [{ usedAt: { lt: before(now, RETENTION_DAYS.verificationTokens) } }, { expiresAt: { lt: before(now, RETENTION_DAYS.verificationTokens) } }] } }),
    prisma.companyInvitation.deleteMany({
      where: { OR: [{ acceptedAt: { lt: before(now, RETENTION_DAYS.invitations) } }, { revokedAt: { lt: before(now, RETENTION_DAYS.invitations) } }, { expiresAt: { lt: before(now, RETENTION_DAYS.invitations) } }] },
    }),
    prisma.applicationError.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.applicationErrors) } } }),
    prisma.stripeEvent.deleteMany({ where: { processedAt: { lt: before(now, RETENTION_DAYS.stripeEvents) } } }),
    prisma.bankConnectSession.deleteMany({ where: { expiresAt: { lt: before(now, RETENTION_DAYS.bankConnectSessions) } } }),
    prisma.notification.deleteMany({ where: { readAt: { lt: before(now, RETENTION_DAYS.readNotifications) } } }),
    prisma.aiSuggestion.deleteMany({ where: { status: { not: "PENDING" }, createdAt: { lt: before(now, RETENTION_DAYS.decidedAiSuggestions) } } }),
    prisma.aiUsage.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.aiUsage) } } }),
    prisma.auditLog.deleteMany({ where: { action: { startsWith: "auth." }, createdAt: { lt: before(now, RETENTION_DAYS.connectionLogs) } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.auditLogs) } } }),
  ]);
  return {
    verificationTokens: tokens.count,
    invitations: invitations.count,
    applicationErrors: appErrors.count,
    stripeEvents: stripeEvents.count,
    bankConnectSessions: connectSessions.count,
    notifications: notifications.count,
    aiSuggestions: suggestions.count,
    aiUsage: aiUsage.count,
    connectionLogs: connections.count,
    auditLogs: audit.count,
  };
}
