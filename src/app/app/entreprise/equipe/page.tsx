import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { listMembers } from "@/server/modules/companies/members";
import { TeamView } from "@/components/app/team-view";

export const metadata: Metadata = { title: "Équipe et accès" };

export default async function TeamPage() {
  const { auth, access } = await requireCompany("members:read");
  const { members, invitations } = await listMembers(access.company.id);
  return (
    <TeamView
      companyId={access.company.id}
      companyName={access.company.name}
      currentUserId={auth.user.id}
      canManage={access.permissions.has("members:manage")}
      members={members}
      invitations={invitations}
    />
  );
}
