import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/guards";
import { AccountView } from "@/components/app/account-view";

export const metadata: Metadata = { title: "Compte et sécurité" };

export default async function AccountPage() {
  const auth = await requireAuth();
  const [user, sessions, subscription] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { firstName: true, lastName: true, email: true, phone: true, mfaEnabledAt: true },
    }),
    prisma.session.findMany({
      where: { userId: auth.user.id, revokedAt: null, mfaPending: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
    prisma.subscription.findUnique({ where: { userId: auth.user.id }, include: { plan: { select: { name: true } } } }),
  ]);

  return (
    <AccountView
      profile={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, mfaEnabled: user.mfaEnabledAt !== null }}
      sessions={sessions.map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        current: s.id === auth.session.id,
      }))}
      subscription={
        subscription
          ? {
              planName: subscription.plan.name,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            }
          : null
      }
    />
  );
}
