import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { generateToken, hashToken } from "@/server/security/crypto";
import type { CompanyAccess } from "@/server/rbac/service";
import type { AuthContext, SessionUser } from "@/server/auth/session-store";
import { INVITATION_TTL_DAYS } from "@/server/auth/constants";
import { getUserPlanLimits } from "@/server/modules/plans/service";
import type { AssignableRoleKey } from "@/server/rbac/permissions";

type Meta = { ip?: string | null; userAgent?: string | null };

export type MemberView = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  roleKey: string;
  roleName: string;
  joinedAt: string;
  mfaEnabled: boolean;
};

export type InvitationView = {
  id: string;
  email: string;
  roleKey: string;
  roleName: string;
  expiresAt: string;
  createdAt: string;
};

export async function listMembers(companyId: string): Promise<{ members: MemberView[]; invitations: InvitationView[] }> {
  const [members, invitations] = await Promise.all([
    prisma.companyUser.findMany({
      where: { companyId, status: "ACTIVE" },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, mfaEnabledAt: true } },
        role: { select: { key: true, name: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.companyInvitation.findMany({
      where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { role: { select: { key: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt.toISOString(),
      mfaEnabled: m.user.mfaEnabledAt !== null,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      roleKey: i.role.key,
      roleName: i.role.name,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

/** Le plafond de membres est celui de la formule du propriétaire de l'entreprise. */
async function assertSeatAvailable(companyId: string): Promise<void> {
  const owner = await prisma.companyUser.findFirst({
    where: { companyId, status: "ACTIVE", role: { key: "OWNER" } },
    select: { userId: true },
  });
  if (!owner) throw errors.notFound("Entreprise introuvable.");
  const plan = await getUserPlanLimits(owner.userId);
  const maxMembers = plan?.limits.maxMembers ?? 1;
  if (plan && plan.limits.maxMembers === null) return;
  const [members, pending] = await Promise.all([
    prisma.companyUser.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.companyInvitation.count({ where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  if (members + pending >= maxMembers) {
    throw new AppError(
      403,
      "PLAN_LIMIT_REACHED",
      `La formule ${plan?.planName ?? "actuelle"} est limitée à ${maxMembers} utilisateur${maxMembers > 1 ? "s" : ""} par entreprise. Passez à une formule supérieure pour inviter davantage de collaborateurs.`,
    );
  }
}

export async function inviteMember(
  access: CompanyAccess,
  inviter: SessionUser,
  input: { email: string; role: AssignableRoleKey },
  meta: Meta = {},
): Promise<InvitationView> {
  const companyId = access.company.id;

  const existingMember = await prisma.companyUser.findFirst({
    where: { companyId, status: "ACTIVE", user: { email: input.email } },
  });
  if (existingMember) throw errors.conflict("ALREADY_MEMBER", "Cette personne est déjà membre de l'entreprise.");

  // Une nouvelle invitation remplace l'éventuelle invitation en attente pour la même adresse.
  await access.db.companyInvitation.updateMany({
    where: { email: input.email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await assertSeatAvailable(companyId);

  const role = await prisma.role.findUniqueOrThrow({ where: { key: input.role } });
  const token = generateToken();
  const invitation = await access.db.companyInvitation.create({
    data: {
      companyId,
      email: input.email,
      roleId: role.id,
      tokenHash: hashToken(token),
      invitedById: inviter.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
    },
  });

  await sendMail(
    mailTemplates.invitation(input.email, `${inviter.firstName} ${inviter.lastName}`, access.company.name, role.name, token),
  );
  await recordAudit({
    action: "member.invite",
    userId: inviter.id,
    companyId,
    entityType: "CompanyInvitation",
    entityId: invitation.id,
    metadata: { role: role.key },
    ...meta,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    roleKey: role.key,
    roleName: role.name,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

export async function revokeInvitation(access: CompanyAccess, userId: string, invitationId: string, meta: Meta = {}): Promise<void> {
  const result = await access.db.companyInvitation.updateMany({
    where: { id: invitationId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw errors.notFound("Invitation introuvable.");
  await recordAudit({
    action: "member.invitation_revoked",
    userId,
    companyId: access.company.id,
    entityType: "CompanyInvitation",
    entityId: invitationId,
    ...meta,
  });
}

async function findManageableMember(access: CompanyAccess, actorUserId: string, memberId: string) {
  const member = await prisma.companyUser.findFirst({
    where: { id: memberId, companyId: access.company.id, status: "ACTIVE" },
    include: { role: { select: { key: true } } },
  });
  if (!member) throw errors.notFound("Membre introuvable.");
  if (member.role.key === "OWNER") throw errors.forbidden("Le rôle du propriétaire ne peut pas être modifié.");
  if (member.userId === actorUserId) throw errors.forbidden("Vous ne pouvez pas modifier votre propre accès.");
  return member;
}

export async function updateMemberRole(
  access: CompanyAccess,
  actorUserId: string,
  memberId: string,
  roleKey: AssignableRoleKey,
  meta: Meta = {},
): Promise<void> {
  const member = await findManageableMember(access, actorUserId, memberId);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.companyUser.update({ where: { id: member.id }, data: { roleId: role.id } });
  await recordAudit({
    action: "member.role_changed",
    userId: actorUserId,
    companyId: access.company.id,
    entityType: "CompanyUser",
    entityId: member.id,
    metadata: { from: member.role.key, to: role.key },
    ...meta,
  });
}

export async function removeMember(access: CompanyAccess, actorUserId: string, memberId: string, meta: Meta = {}): Promise<void> {
  const member = await findManageableMember(access, actorUserId, memberId);
  await prisma.$transaction([
    prisma.companyUser.update({ where: { id: member.id }, data: { status: "REVOKED", revokedAt: new Date() } }),
    // Les sessions du membre retiré ne doivent plus pointer vers cette entreprise.
    prisma.session.updateMany({
      where: { userId: member.userId, activeCompanyId: access.company.id },
      data: { activeCompanyId: null },
    }),
  ]);
  await recordAudit({
    action: "member.removed",
    userId: actorUserId,
    companyId: access.company.id,
    entityType: "CompanyUser",
    entityId: member.id,
    ...meta,
  });
}

// ---------------------------------------------------------------------------
// Acceptation d'une invitation
// ---------------------------------------------------------------------------

async function findValidInvitation(token: string) {
  const invitation = await prisma.companyInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      company: { select: { id: true, name: true, status: true } },
      role: { select: { key: true, name: true } },
      invitedBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (
    !invitation ||
    invitation.revokedAt ||
    invitation.acceptedAt ||
    invitation.expiresAt.getTime() <= Date.now() ||
    invitation.company.status !== "ACTIVE"
  ) {
    throw errors.notFound("Cette invitation est invalide, expirée ou a déjà été utilisée.");
  }
  return invitation;
}

/** Informations affichées au destinataire avant acceptation. */
export async function getInvitationPreview(token: string) {
  const invitation = await findValidInvitation(token);
  return {
    companyName: invitation.company.name,
    roleName: invitation.role.name,
    invitedBy: `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`,
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function acceptInvitation(auth: AuthContext, token: string, meta: Meta = {}): Promise<{ companyId: string }> {
  const invitation = await findValidInvitation(token);
  if (invitation.email.toLowerCase() !== auth.user.email.toLowerCase()) {
    throw errors.forbidden(
      "Cette invitation est destinée à une autre adresse e-mail. Connectez-vous avec le compte correspondant.",
    );
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { key: invitation.role.key } });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.companyInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw errors.notFound("Cette invitation a déjà été utilisée.");
    await tx.companyUser.upsert({
      where: { companyId_userId: { companyId: invitation.company.id, userId: auth.user.id } },
      create: { companyId: invitation.company.id, userId: auth.user.id, roleId: role.id },
      update: { roleId: role.id, status: "ACTIVE", revokedAt: null, joinedAt: new Date() },
    });
    await tx.notification.create({
      data: {
        userId: invitation.invitedById,
        companyId: invitation.company.id,
        type: "member.joined",
        title: `${auth.user.firstName} ${auth.user.lastName} a rejoint ${invitation.company.name}`,
        body: `Rôle attribué : ${invitation.role.name}.`,
        link: "/app/entreprise/equipe",
      },
    });
  });

  await recordAudit({
    action: "member.joined",
    userId: auth.user.id,
    companyId: invitation.company.id,
    entityType: "CompanyInvitation",
    entityId: invitation.id,
    metadata: { role: invitation.role.key },
    ...meta,
  });
  return { companyId: invitation.company.id };
}
