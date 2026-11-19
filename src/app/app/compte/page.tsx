import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/guards";
import { AccountView } from "@/components/app/account-view";
import { deletionCheck } from "@/server/modules/account/deletion";

export const metadata: Metadata = { title: "Compte et sécurité" };

type Props = { searchParams: Promise<{ mfa?: string }> };

export default async function AccountPage({ searchParams }: Props) {
  const [auth, params] = await Promise.all([requireAuth(), searchParams]);
  const [user, sessions, subscription, deletion] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        mfaEnabledAt: true,
      },
    }),
    prisma.session.findMany({
      where: {
        userId: auth.user.id,
        revokedAt: null,
        mfaPending: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.subscription.findUnique({
      where: { userId: auth.user.id },
      include: { plan: { select: { name: true } } },
    }),
    deletionCheck(auth.user.id),
  ]);

  const adminNotice =
    params.mfa === "admin" && auth.user.isSuperAdmin && !user.mfaEnabledAt;
  return (
    <>
      {adminNotice ? (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm"
        >
          L'administration de la plateforme exige la double authentification.
          Activez-la ci-dessous, puis revenez sur l'administration.
        </p>
      ) : null}
      <AccountView
        profile={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          mfaEnabled: user.mfaEnabledAt !== null,
        }}
        deletion={deletion}
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
                currentPeriodEnd:
                  subscription.currentPeriodEnd?.toISOString() ?? null,
              }
            : null
        }
      />
    </>
  );
}
