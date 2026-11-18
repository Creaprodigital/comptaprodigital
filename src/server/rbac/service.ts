import type { Company } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import type { PermissionKey } from "@/server/rbac/permissions";
import { tenantDb, type TenantDb } from "@/server/tenancy/tenant-db";
import { isCompanyReadOnly } from "@/server/billing/standing";

/**
 * Contrôle d'accès : toute opération sur les données d'une entreprise passe par
 * `authorizeCompany`, qui vérifie l'appartenance de l'utilisateur à l'entreprise
 * puis la permission requise, et retourne un client de base de données déjà
 * cloisonné sur cette entreprise.
 */

const CACHE_TTL_MS = 60_000;
let permissionCache: { loadedAt: number; byRole: Map<string, Set<string>> } | null = null;

async function loadRolePermissions(): Promise<Map<string, Set<string>>> {
  if (permissionCache && Date.now() - permissionCache.loadedAt < CACHE_TTL_MS) {
    return permissionCache.byRole;
  }
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  const byRole = new Map(roles.map((role) => [role.key, new Set(role.permissions.map((rp) => rp.permission.key))]));
  permissionCache = { loadedAt: Date.now(), byRole };
  return byRole;
}

export function invalidatePermissionCache() {
  permissionCache = null;
}

export async function roleHasPermission(roleKey: string, permission: PermissionKey): Promise<boolean> {
  const byRole = await loadRolePermissions();
  return byRole.get(roleKey)?.has(permission) ?? false;
}

export async function getRolePermissions(roleKey: string): Promise<PermissionKey[]> {
  const byRole = await loadRolePermissions();
  return [...(byRole.get(roleKey) ?? [])] as PermissionKey[];
}

export type CompanyAccess = {
  company: Company;
  membershipId: string;
  roleKey: string;
  permissions: Set<string>;
  /** Client Prisma cloisonné : toutes les requêtes sont filtrées sur l'entreprise. */
  db: TenantDb;
};

/**
 * Retourne l'accès de l'utilisateur à l'entreprise, ou `null` s'il n'en est pas
 * membre actif. Un super administrateur n'a aucun accès implicite.
 */
export async function getCompanyAccess(userId: string, companyId: string): Promise<CompanyAccess | null> {
  const membership = await prisma.companyUser.findUnique({
    where: { companyId_userId: { companyId, userId } },
    include: { company: true, role: { select: { key: true } } },
  });
  if (!membership || membership.status !== "ACTIVE") return null;
  const byRole = await loadRolePermissions();
  return {
    company: membership.company,
    membershipId: membership.id,
    roleKey: membership.role.key,
    permissions: byRole.get(membership.role.key) ?? new Set(),
    db: tenantDb(companyId),
  };
}

export async function authorizeCompany(
  userId: string,
  companyId: string,
  permission: PermissionKey,
  options: { allowSuspended?: boolean; allowArchived?: boolean } = {},
): Promise<CompanyAccess> {
  const access = await getCompanyAccess(userId, companyId);
  // 404 plutôt que 403 : on ne révèle pas l'existence d'une entreprise à un non-membre.
  if (!access) throw errors.notFound("Entreprise introuvable.");
  if (access.company.status === "SUSPENDED" && !options.allowSuspended) {
    throw new AppError(403, "COMPANY_SUSPENDED", "Cette entreprise est suspendue. Contactez le support.");
  }
  if (access.company.status === "ARCHIVED" && !options.allowArchived) {
    throw new AppError(403, "COMPANY_ARCHIVED", "Cette entreprise est archivée.");
  }
  if (!access.permissions.has(permission)) throw errors.forbidden();
  // Abonnement du propriétaire inactif : consultation et exports restent possibles, pas les modifications.
  if (isMutatingPermission(permission) && (await isCompanyReadOnly(companyId))) {
    throw new AppError(
      402,
      "SUBSCRIPTION_INACTIVE",
      "L'abonnement de cette entreprise n'est plus actif : vos données restent consultables et exportables, mais ne peuvent plus être modifiées. Le titulaire peut réactiver l'abonnement depuis la page Abonnement.",
    );
  }
  return access;
}

/** Droits qui modifient des données (les droits de consultation et d'export restent ouverts en lecture seule). */
export function isMutatingPermission(permission: PermissionKey): boolean {
  return !permission.endsWith(":read") && permission !== "exports:run";
}

export function can(access: Pick<CompanyAccess, "permissions">, permission: PermissionKey): boolean {
  return access.permissions.has(permission);
}
