import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { getAppContext } from "@/server/auth/guards";
import { getUserPlanLimits } from "@/server/modules/plans/service";
import { CompaniesView } from "@/components/app/companies-view";

export const metadata: Metadata = { title: "Mes entreprises" };

type Props = { searchParams: Promise<{ nouvelle?: string }> };

export default async function CompaniesPage({ searchParams }: Props) {
  const [{ auth, companies, access }, params] = await Promise.all([getAppContext(), searchParams]);
  const [plan, owned] = await Promise.all([
    getUserPlanLimits(auth.user.id),
    prisma.companyUser.count({
      where: { userId: auth.user.id, status: "ACTIVE", role: { key: "OWNER" }, company: { status: { not: "ARCHIVED" } } },
    }),
  ]);
  return (
    <CompaniesView
      companies={companies}
      activeCompanyId={access?.company.id ?? null}
      plan={plan ? { name: plan.planName, maxCompanies: plan.limits.maxCompanies, owned } : null}
      openCreate={params.nouvelle === "1"}
    />
  );
}
