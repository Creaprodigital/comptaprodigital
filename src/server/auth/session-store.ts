import type { Session, User } from "@prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { generateToken, hashToken } from "@/server/security/crypto";
import { PENDING_MFA_TTL_MINUTES } from "@/server/auth/constants";

/**
 * Sessions serveur : le cookie ne contient qu'un jeton opaque aléatoire ;
 * la base n'en conserve que l'empreinte. Une session peut donc être révoquée
 * immédiatement (déconnexion, changement de mot de passe, suspension).
 */

export type SessionUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "isSuperAdmin" | "status" | "emailVerifiedAt" | "mfaEnabledAt"
>;

export type AuthContext = {
  session: Pick<Session, "id" | "mfaPending" | "activeCompanyId" | "expiresAt" | "createdAt">;
  user: SessionUser;
};

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  isSuperAdmin: true,
  status: true,
  emailVerifiedAt: true,
  mfaEnabledAt: true,
} as const;

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export async function createSession(input: {
  userId: string;
  mfaPending?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  activeCompanyId?: string | null;
}): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = generateToken();
  const ttlMs = input.mfaPending ? PENDING_MFA_TTL_MINUTES * 60_000 : env().SESSION_TTL_DAYS * DAY_MS;
  const expiresAt = new Date(Date.now() + ttlMs);
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      mfaPending: input.mfaPending ?? false,
      activeCompanyId: input.activeCompanyId ?? null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt, sessionId: session.id };
}

/**
 * Valide un jeton de session. Retourne `null` si la session est inconnue,
 * expirée, révoquée, inactive depuis trop longtemps, ou si le compte n'est plus actif.
 */
export async function validateSessionToken(
  token: string,
  options: { allowMfaPending?: boolean } = {},
): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: USER_SELECT } },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (!session.mfaPending && now - session.lastSeenAt.getTime() > env().SESSION_IDLE_DAYS * DAY_MS) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (session.mfaPending && !options.allowMfaPending) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }

  return {
    session: {
      id: session.id,
      mfaPending: session.mfaPending,
      activeCompanyId: session.activeCompanyId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    },
    user: session.user,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function setActiveCompany(sessionId: string, companyId: string | null): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
}

/** Purge des sessions expirées ou révoquées depuis plus de 30 jours (tâche planifiée). */
export async function purgeStaleSessions(): Promise<number> {
  const threshold = new Date(Date.now() - 30 * DAY_MS);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: threshold } }, { revokedAt: { lt: threshold } }] },
  });
  return result.count;
}
