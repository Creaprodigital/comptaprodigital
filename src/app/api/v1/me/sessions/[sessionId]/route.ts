import { authRoute, noContent } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit/audit";

/** Révocation d'une de ses propres sessions (déconnexion à distance). */
export const DELETE = authRoute<{ sessionId: string }>({}, async ({ auth, params, meta }) => {
  const result = await prisma.session.updateMany({
    where: { id: params.sessionId, userId: auth.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw errors.notFound("Session introuvable.");
  await recordAudit({ action: "auth.session_revoked", userId: auth.user.id, entityType: "Session", entityId: params.sessionId, ...meta });
  return noContent();
});
