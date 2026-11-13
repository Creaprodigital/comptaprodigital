import { authRoute } from "@/server/http/api";
import { prisma } from "@/server/db";

export const GET = authRoute({}, async ({ auth }) => {
  const sessions = await prisma.session.findMany({
    where: { userId: auth.user.id, revokedAt: null, mfaPending: false, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
  return sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    current: s.id === auth.session.id,
  }));
});
