import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/server/http/errors";
import { authorizeCompany } from "@/server/rbac/service";
import { ALL_PERMISSIONS, COMPANY_ROLE_KEYS, ROLE_DEFINITIONS, type PermissionKey } from "@/server/rbac/permissions";
import { invalidateSettingsCache, updateSetting } from "@/server/modules/admin/settings";
import { addMember, createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

/**
 * Matrice complète des permissions, vérifiée sur la base réelle : pour chaque rôle et chaque
 * permission, l'accès est accordé si et seulement si le référentiel le prévoit ; un non-membre,
 * un membre révoqué ou une entreprise suspendue n'obtiennent rien ; un abonnement inactif
 * bloque toutes les modifications mais laisse la consultation et les exports.
 */

const members: Partial<Record<(typeof COMPANY_ROLE_KEYS)[number], string>> = {};
let companyId: string;
let outsiderId: string;
let ownerId: string;

async function outcome(userId: string, permission: PermissionKey): Promise<"ok" | string> {
  try {
    await authorizeCompany(userId, companyId, permission);
    return "ok";
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

beforeAll(async () => {
  await resetDatabase();
  const owner = await createVerifiedUser({ email: "matrice-titulaire@exemple.test", plan: "BUSINESS" });
  ownerId = owner.id;
  companyId = (await createTestCompany(owner.id, "Matrice SAS")).id;
  members.OWNER = owner.id;
  for (const role of COMPANY_ROLE_KEYS.filter((r) => r !== "OWNER")) {
    const user = await createVerifiedUser({ email: `matrice-${role.toLowerCase()}@exemple.test` });
    await addMember(companyId, user.id, role);
    members[role] = user.id;
  }
  outsiderId = (await createVerifiedUser({ email: "matrice-tiers@exemple.test" })).id;
});

afterAll(async () => {
  await updateSetting("billing.enforcement", "auto", ownerId).catch(() => undefined);
  invalidateSettingsCache();
});

describe("matrice rôles × permissions", () => {
  for (const role of COMPANY_ROLE_KEYS) {
    it(`${ROLE_DEFINITIONS[role].name} : exactement les droits prévus`, async () => {
      const expected = new Set<string>(ROLE_DEFINITIONS[role].permissions);
      const actual = await Promise.all(ALL_PERMISSIONS.map(async (p) => [p, await outcome(members[role]!, p)] as const));
      for (const [permission, result] of actual) {
        expect({ permission, result }).toEqual({ permission, result: expected.has(permission) ? "ok" : "FORBIDDEN" });
      }
    });
  }

  it("un non-membre ne voit même pas l'entreprise (404, jamais 403)", async () => {
    for (const permission of ALL_PERMISSIONS) expect(await outcome(outsiderId, permission)).toBe("NOT_FOUND");
  });

  it("un membre révoqué perd tout accès", async () => {
    await prisma.companyUser.updateMany({ where: { companyId, userId: members.READ_ONLY }, data: { status: "REVOKED" } });
    expect(await outcome(members.READ_ONLY!, "dashboard:read")).toBe("NOT_FOUND");
    await prisma.companyUser.updateMany({ where: { companyId, userId: members.READ_ONLY }, data: { status: "ACTIVE" } });
  });

  it("une entreprise suspendue est inaccessible à tous ses membres", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { status: "SUSPENDED" } });
    for (const role of COMPANY_ROLE_KEYS) expect(await outcome(members[role]!, "dashboard:read")).toBe("COMPANY_SUSPENDED");
    await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
  });

  it("abonnement inactif : consultation et exports seulement, pour tous les rôles", async () => {
    await updateSetting("billing.enforcement", "on", ownerId);
    await prisma.subscription.update({ where: { userId: ownerId }, data: { status: "EXPIRED" } });
    for (const role of COMPANY_ROLE_KEYS) {
      for (const permission of ROLE_DEFINITIONS[role].permissions) {
        const readOnly = permission.endsWith(":read") || permission === "exports:run";
        expect({ role, permission, result: await outcome(members[role]!, permission) }).toEqual({ role, permission, result: readOnly ? "ok" : "SUBSCRIPTION_INACTIVE" });
      }
    }
    await prisma.subscription.update({ where: { userId: ownerId }, data: { status: "TRIALING", trialEndsAt: new Date(Date.now() + 7 * 86400_000) } });
    expect(await outcome(members.COLLABORATOR!, "invoices:write")).toBe("ok");
  });
});
