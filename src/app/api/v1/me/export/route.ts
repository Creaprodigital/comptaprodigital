import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit/audit";
import { RATE_LIMITS } from "@/server/security/rate-limit";

/**
 * Droit d'accès et à la portabilité (RGPD, art. 15 et 20) : export des données
 * personnelles du compte. Les données comptables des entreprises relèvent des
 * exports dédiés, soumis aux permissions de chaque entreprise.
 */
export const GET = authRoute({ rateLimit: RATE_LIMITS.emailToken }, async ({ auth, meta }) => {
  const userId = auth.user.id;
  const [user, memberships, sessions, notifications, auditLogs, tickets, subscription] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, locale: true,
        emailVerifiedAt: true, termsAcceptedAt: true, mfaEnabledAt: true, lastLoginAt: true, createdAt: true,
      },
    }),
    prisma.companyUser.findMany({
      where: { userId },
      select: { status: true, joinedAt: true, revokedAt: true, company: { select: { name: true, siren: true } }, role: { select: { name: true } } },
    }),
    prisma.session.findMany({ where: { userId }, select: { ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, revokedAt: true } }),
    prisma.notification.findMany({ where: { userId }, select: { type: true, title: true, body: true, createdAt: true, readAt: true } }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { action: true, entityType: true, ipAddress: true, createdAt: true },
    }),
    prisma.supportTicket.findMany({ where: { userId }, select: { reference: true, subject: true, status: true, createdAt: true } }),
    prisma.subscription.findUnique({
      where: { userId },
      select: { status: true, billingInterval: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { name: true } } },
    }),
  ]);
  await recordAudit({ action: "user.data_export", userId, ...meta });
  const payload = { exportedAt: new Date().toISOString(), user, subscription, memberships, sessions, notifications, supportTickets: tickets, activity: auditLogs };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mes-donnees-comptapro.json"',
      "Cache-Control": "no-store",
    },
  });
});
