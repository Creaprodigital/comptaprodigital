import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { listMembers } from "@/server/modules/companies/members";
import { listGrants } from "@/server/modules/admin/access-grants";
import { TeamView } from "@/components/app/team-view";
import { SupportAccess } from "@/components/app/support-access";

export const metadata: Metadata = { title: "Équipe et accès" };

export default async function TeamPage() {
  const { auth, access } = await requireCompany("members:read");
  const [{ members, invitations }, grants] = await Promise.all([listMembers(access.company.id), listGrants(access.company.id)]);
  return (
    <>
      <TeamView
        companyId={access.company.id}
        companyName={access.company.name}
        currentUserId={auth.user.id}
        canManage={access.permissions.has("members:manage")}
        members={members}
        invitations={invitations}
      />
      <SupportAccess
        companyId={access.company.id}
        grants={grants.map((g) => ({ id: g.id, admin: g.admin, reason: g.reason, createdAt: g.createdAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, active: g.active, views: g.views }))}
        canRevoke={access.roleKey === "OWNER" || access.roleKey === "COMPANY_ADMIN"}
      />
    </>
  );
}
