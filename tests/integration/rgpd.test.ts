import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { login } from "@/server/auth/auth-service";
import { resetStripeClient } from "@/server/billing/stripe";
import { deleteAccount, deletionCheck } from "@/server/modules/account/deletion";
import { runRetentionPurges } from "@/server/modules/retention/service";
import { FakeStripe } from "../support/fake-stripe";
import { addMember, createTestCompany, createVerifiedUser, lastMailTo, loginAs, PASSWORD, prisma, resetDatabase } from "./helpers";

const fake = new FakeStripe();
const saved = { ...process.env };

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

beforeAll(async () => {
  await resetDatabase();
  const base = await fake.start();
  Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: base });
  resetEnvCache();
  resetStripeClient();
});

afterAll(async () => {
  await fake.stop();
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_BASE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  resetStripeClient();
});

describe("suppression de compte", () => {
  it("refuse tant qu'une entreprise est partagée, puis anonymise, archive et résilie", async () => {
    const owner = await createVerifiedUser({ email: "partant@exemple.test", firstName: "Iris", plan: "BUSINESS" });
    const shared = await createTestCompany(owner.id, "Société Partagée");
    const solo = await createTestCompany(owner.id, "Société Solo");
    const colleague = await createVerifiedUser({ email: "reste@exemple.test" });
    const membership = await addMember(shared.id, colleague.id, "COLLABORATOR");
    // Abonnement payant chez Stripe.
    const sub = fake.subscriptions;
    sub.set("sub_partant", { id: "sub_partant", object: "subscription", status: "active" });
    await prisma.subscription.update({ where: { userId: owner.id }, data: { stripeSubscriptionId: "sub_partant", status: "ACTIVE" } });

    const auth = await loginAs(owner.email);
    const check = await deletionCheck(owner.id);
    expect(check.allowed).toBe(false);
    expect(check.blockers[0]).toContain("Société Partagée");
    await expectAppError(deleteAccount(auth, { password: PASSWORD, confirmation: "SUPPRIMER" }), "DELETION_BLOCKED");

    await prisma.companyUser.update({ where: { id: membership.id }, data: { status: "REVOKED" } });
    await expectAppError(deleteAccount(auth, { password: "mauvais", confirmation: "SUPPRIMER" }), "INVALID_PASSWORD");
    await expectAppError(deleteAccount(auth, { password: PASSWORD, confirmation: "oui" }), "VALIDATION_ERROR");

    const result = await deleteAccount(auth, { password: PASSWORD, confirmation: "supprimer" });
    expect(result.archivedCompanies.map((c) => c.name).sort()).toEqual(["Société Partagée", "Société Solo"]);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user).toMatchObject({ status: "DELETED", firstName: "Compte", lastName: "supprimé", phone: null, mfaSecretEncrypted: null });
    expect(user.email).toBe(`supprime-${owner.id}@supprime.invalid`);
    expect(await prisma.session.count({ where: { userId: owner.id, revokedAt: null } })).toBe(0);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { userId: owner.id } })).toMatchObject({ status: "CANCELED" });
    expect(fake.requests.some((r) => r.method === "DELETE" && r.path === "/v1/subscriptions/sub_partant")).toBe(true);
    // Données comptables conservées, entreprises archivées.
    expect((await prisma.company.findUniqueOrThrow({ where: { id: solo.id } })).status).toBe("ARCHIVED");
    expect(await prisma.fiscalYear.count({ where: { companyId: solo.id } })).toBe(1);
    // Plus de connexion possible ; l'ancienne adresse a été prévenue.
    await expectAppError(login({ email: "partant@exemple.test", password: PASSWORD }), "INVALID_CREDENTIALS");
    expect(lastMailTo("partant@exemple.test").subject).toContain("Votre compte a été supprimé");
    expect(await prisma.auditLog.count({ where: { action: "account.deleted", userId: owner.id } })).toBe(1);
    // L'adresse est de nouveau libre pour une inscription.
    await expect(createVerifiedUser({ email: "partant@exemple.test" })).resolves.toBeTruthy();
  });

  it("exige le code de double authentification lorsqu'elle est activée", async () => {
    const user = await createVerifiedUser({ email: "prudent@exemple.test" });
    const auth = await loginAs(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date(), mfaSecretEncrypted: (await import("@/server/security/crypto")).encryptSecret("JBSWY3DPEHPK3PXP") } });
    await expectAppError(deleteAccount(auth, { password: PASSWORD, confirmation: "SUPPRIMER" }), "INVALID_MFA_CODE");
    await expectAppError(deleteAccount(auth, { password: PASSWORD, code: "000000", confirmation: "SUPPRIMER" }), "INVALID_MFA_CODE");
  });
});

describe("politique de conservation", () => {
  it("purge les données arrivées à échéance et elles seules", async () => {
    const user = await createVerifiedUser({ email: "conservation@exemple.test" });
    const company = await createTestCompany(user.id, "Archives SARL");
    const old = (days: number) => new Date(Date.now() - days * 86400_000);
    await prisma.verificationToken.createMany({ data: [
      { userId: user.id, type: "EMAIL_VERIFICATION", tokenHash: "a".repeat(64), expiresAt: old(10) },
      { userId: user.id, type: "EMAIL_VERIFICATION", tokenHash: "b".repeat(64), expiresAt: new Date(Date.now() + 3600_000) },
    ] });
    await prisma.applicationError.createMany({ data: [{ message: "vieille", createdAt: old(100) }, { message: "récente" }] });
    await prisma.notification.createMany({ data: [
      { userId: user.id, type: "t", title: "lue ancienne", readAt: old(200), createdAt: old(200) },
      { userId: user.id, type: "t", title: "non lue ancienne", createdAt: old(200) },
    ] });
    await prisma.aiUsage.createMany({ data: [
      { companyId: company.id, feature: "ASSISTANT", model: "m", status: "OK", createdAt: old(500) },
      { companyId: company.id, feature: "ASSISTANT", model: "m", status: "OK" },
    ] });
    await prisma.auditLog.createMany({ data: [
      { action: "auth.login", userId: user.id, createdAt: old(400) },
      { action: "invoice.issue", userId: user.id, createdAt: old(400) },
      { action: "invoice.issue", userId: user.id, createdAt: old(7 * 365) },
    ] });
    const before = await prisma.auditLog.count();
    const result = await runRetentionPurges();
    expect(result).toMatchObject({ applicationErrors: 1, notifications: 1, aiUsage: 1 });
    expect(result.verificationTokens).toBeGreaterThanOrEqual(1);
    expect(await prisma.verificationToken.count({ where: { tokenHash: "b".repeat(64) } })).toBe(1);
    expect(await prisma.notification.findMany({ where: { userId: user.id, type: "t" }, select: { title: true } })).toEqual([{ title: "non lue ancienne" }]);
    // Connexion de plus d'un an et modification de plus de six ans purgées ; modification d'un an conservée.
    expect(result).toMatchObject({ connectionLogs: 1, auditLogs: 1 });
    expect(await prisma.auditLog.count()).toBe(before - 2);
    expect(await prisma.auditLog.count({ where: { action: "invoice.issue", userId: user.id } })).toBe(1);
  });
});
