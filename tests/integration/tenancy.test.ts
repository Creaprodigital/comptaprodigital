import { beforeAll, describe, expect, it } from "vitest";
import { TenantIsolationError, tenantDb } from "@/server/tenancy/tenant-db";
import { authorizeCompany, getCompanyAccess } from "@/server/rbac/service";
import { ROLE_DEFINITIONS, type PermissionKey } from "@/server/rbac/permissions";
import { addMember, createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

let companyA: string;
let companyB: string;
let ownerA: string;
let ownerB: string;
let customerOfB: string;

beforeAll(async () => {
  await resetDatabase();
  ownerA = (await createVerifiedUser({ email: "a@exemple.test" })).id;
  ownerB = (await createVerifiedUser({ email: "b@exemple.test" })).id;
  companyA = (await createTestCompany(ownerA, "Entreprise A")).id;
  companyB = (await createTestCompany(ownerB, "Entreprise B")).id;
  await tenantDb(companyA).customer.create({ data: { companyId: companyA, name: "Client de A" } });
  customerOfB = (await tenantDb(companyB).customer.create({ data: { companyId: companyB, name: "Client de B" } })).id;
});

describe("isolation des données entre entreprises", () => {
  it("ne lit que les données de l'entreprise courante", async () => {
    const db = tenantDb(companyA);
    expect((await db.customer.findMany()).map((c) => c.name)).toEqual(["Client de A"]);
    expect(await db.customer.count()).toBe(1);
    expect(await db.customer.findMany({ where: { name: { contains: "Client" } } })).toHaveLength(1);
    // Un filtre explicite sur une autre entreprise est rejeté.
    await expect(db.customer.findMany({ where: { companyId: companyB } })).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(db.customer.count({ where: { companyId: companyB } })).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("ne trouve pas un enregistrement d'une autre entreprise, même par son identifiant", async () => {
    const db = tenantDb(companyA);
    expect(await db.customer.findUnique({ where: { id: customerOfB } })).toBeNull();
    expect(await db.customer.findFirst({ where: { id: customerOfB } })).toBeNull();
    await expect(db.customer.findUniqueOrThrow({ where: { id: customerOfB } })).rejects.toThrow();
  });

  it("ne peut ni modifier ni supprimer les données d'une autre entreprise", async () => {
    const db = tenantDb(companyA);
    await expect(db.customer.update({ where: { id: customerOfB }, data: { name: "Piraté" } })).rejects.toThrow();
    await expect(db.customer.delete({ where: { id: customerOfB } })).rejects.toThrow();
    expect((await db.customer.updateMany({ where: { id: customerOfB }, data: { name: "Piraté" } })).count).toBe(0);
    expect((await db.customer.deleteMany({ where: { id: customerOfB } })).count).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerOfB } })).name).toBe("Client de B");
  });

  it("impose l'entreprise à la création et refuse toute autre valeur", async () => {
    const db = tenantDb(companyA);
    const created = await db.customer.create({ data: { name: "Sans entreprise explicite" } as never });
    expect(created.companyId).toBe(companyA);
    await expect(db.customer.create({ data: { companyId: companyB, name: "Injection" } })).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(db.customer.createMany({ data: [{ companyId: companyB, name: "Injection" }] })).rejects.toBeInstanceOf(TenantIsolationError);
    expect(await prisma.customer.count({ where: { companyId: companyB } })).toBe(1);
  });

  it("interdit de déplacer un enregistrement vers une autre entreprise", async () => {
    const db = tenantDb(companyA);
    const own = await db.customer.findFirstOrThrow();
    await expect(db.customer.update({ where: { id: own.id }, data: { companyId: companyB } })).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(db.customer.updateMany({ data: { companyId: companyB } })).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("cloisonne aussi les agrégats", async () => {
    await tenantDb(companyB).product.create({ data: { companyId: companyB, name: "Prestation B", unitPriceExclTax: "500.00", vatRate: "20.00" } });
    const aggregate = await tenantDb(companyA).product.aggregate({ _sum: { unitPriceExclTax: true }, _count: true });
    expect(aggregate._count).toBe(0);
    expect(aggregate._sum.unitPriceExclTax).toBeNull();
  });

  it("exige un identifiant d'entreprise", () => {
    expect(() => tenantDb("")).toThrow(TenantIsolationError);
  });
});

describe("contrôle d'accès par rôle", () => {
  it("refuse l'accès à un non-membre sans révéler l'existence de l'entreprise", async () => {
    expect(await getCompanyAccess(ownerA, companyB)).toBeNull();
    await expect(authorizeCompany(ownerA, companyB, "company:read")).rejects.toMatchObject({ status: 404 });
    await expect(authorizeCompany(ownerA, "identifiant-inexistant", "company:read")).rejects.toMatchObject({ status: 404 });
  });

  it("n'accorde aucun accès implicite à un super administrateur", async () => {
    const admin = await createVerifiedUser({ email: "superadmin@exemple.test" });
    await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
    await expect(authorizeCompany(admin.id, companyA, "dashboard:read")).rejects.toMatchObject({ status: 404 });
  });

  it("applique la matrice de permissions de chaque rôle, telle que stockée en base", async () => {
    const checks: PermissionKey[] = ["dashboard:read", "invoices:write", "members:manage", "company:update", "company:delete", "accounting:close", "exports:run"];
    for (const roleKey of ["COMPANY_ADMIN", "COLLABORATOR", "READ_ONLY", "EXTERNAL_ACCOUNTANT"] as const) {
      const user = await createVerifiedUser({ email: `${roleKey.toLowerCase()}@exemple.test` });
      await addMember(companyA, user.id, roleKey);
      for (const permission of checks) {
        const expected = ROLE_DEFINITIONS[roleKey].permissions.includes(permission);
        const outcome = authorizeCompany(user.id, companyA, permission);
        if (expected) await expect(outcome, `${roleKey} → ${permission}`).resolves.toBeDefined();
        else await expect(outcome, `${roleKey} ✗ ${permission}`).rejects.toMatchObject({ status: 403 });
      }
    }
  });

  it("retire immédiatement l'accès d'un membre révoqué", async () => {
    const user = await createVerifiedUser({ email: "revoque@exemple.test" });
    const membership = await addMember(companyA, user.id, "COLLABORATOR");
    await expect(authorizeCompany(user.id, companyA, "dashboard:read")).resolves.toBeDefined();
    await prisma.companyUser.update({ where: { id: membership.id }, data: { status: "REVOKED" } });
    await expect(authorizeCompany(user.id, companyA, "dashboard:read")).rejects.toMatchObject({ status: 404 });
  });

  it("bloque une entreprise suspendue, sauf consultation explicitement autorisée", async () => {
    await prisma.company.update({ where: { id: companyB }, data: { status: "SUSPENDED" } });
    await expect(authorizeCompany(ownerB, companyB, "dashboard:read")).rejects.toMatchObject({ status: 403, code: "COMPANY_SUSPENDED" });
    await expect(authorizeCompany(ownerB, companyB, "company:read", { allowSuspended: true })).resolves.toBeDefined();
    await prisma.company.update({ where: { id: companyB }, data: { status: "ACTIVE" } });
  });
});
