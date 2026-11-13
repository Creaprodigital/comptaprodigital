import { authRoute } from "@/server/http/api";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit/audit";
import { listUserCompanies } from "@/server/modules/companies/service";
import { updateProfileSchema } from "@/lib/schemas/auth";

export const GET = authRoute({}, async ({ auth }) => {
  const [companies, subscription] = await Promise.all([
    listUserCompanies(auth.user.id),
    prisma.subscription.findUnique({ where: { userId: auth.user.id }, include: { plan: { select: { key: true, name: true } } } }),
  ]);
  return {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      mfaEnabled: auth.user.mfaEnabledAt !== null,
      isSuperAdmin: auth.user.isSuperAdmin,
    },
    activeCompanyId: auth.session.activeCompanyId,
    companies,
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
  };
});

export const PATCH = authRoute({ body: updateProfileSchema }, async ({ auth, body, meta }) => {
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { firstName: body.firstName, lastName: body.lastName, phone: body.phone || null },
    select: { firstName: true, lastName: true, phone: true },
  });
  await recordAudit({ action: "user.profile_updated", userId: auth.user.id, ...meta });
  return user;
});
