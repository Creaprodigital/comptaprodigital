import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { assertSuperAdmin } from "@/server/admin/guard-core";
import { authorizeCompany } from "@/server/rbac/service";
import { resetStripeClient } from "@/server/billing/stripe";
import { saasMetrics } from "@/server/modules/admin/metrics";
import { extendTrial, getUserAdmin, listUsers, setPlanManually, setUserSuspended } from "@/server/modules/admin/users";
import { getCompanyAdmin, listCompanies, setCompanyStatus } from "@/server/modules/admin/companies";
import { financialSnapshot, listGrants, requestAccess, revokeGrant } from "@/server/modules/admin/access-grants";
import { listAdminPlans, syncPlanToStripe, updatePlan } from "@/server/modules/admin/plans";
import { exportAuditCsv, listAudit } from "@/server/modules/admin/audit";
import { purgeErrors } from "@/server/modules/admin/errors";
import { integrationsStatus } from "@/server/modules/admin/integrations";
import { invalidateSettingsCache, updateSetting } from "@/server/modules/admin/settings";
import { login } from "@/server/auth/auth-service";
import { planUpdateSchema } from "@/lib/schemas/admin";
import { FakeStripe } from "../support/fake-stripe";
import { createTestCompany, createVerifiedUser, lastMailTo, loginAs, PASSWORD, prisma, resetDatabase } from "./helpers";

const fake = new FakeStripe();
const saved = { ...process.env };

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

let adminId: string;
let ownerId: string;
let ownerEmail: string;
let companyId: string;

beforeAll(async () => {
  await resetDatabase();
  invalidateSettingsCache();
  const admin = await createVerifiedUser({ email: "admin@plateforme.test", firstName: "Alix" });
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  adminId = admin.id;
  const owner = await createVerifiedUser({ email: "titulaire@exemple.test", firstName: "Noé", plan: "PRO" });
  ownerId = owner.id;
  ownerEmail = owner.email;
  companyId = (await createTestCompany(ownerId, "Atelier Surveillé")).id;
});

afterAll(async () => {
  await fake.stop().catch(() => undefined);
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_BASE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  resetStripeClient();
  invalidateSettingsCache();
});

describe("accès à l'administration", () => {
  it("n'existe pas pour un client et exige la double authentification pour un administrateur", async () => {
    const client = await loginAs(ownerEmail);
    expect(() => assertSuperAdmin(client)).toThrow(expect.objectContaining({ status: 404 }));
    const admin = await loginAs("admin@plateforme.test");
    expect(() => assertSuperAdmin(admin)).toThrow(expect.objectContaining({ code: "ADMIN_MFA_REQUIRED" }));
    expect(() => assertSuperAdmin({ ...admin, user: { ...admin.user, mfaEnabledAt: new Date() } })).not.toThrow();
  });
});

describe("indicateurs SaaS", () => {
  it("calcule le MRR, l'ARR et les encaissements en décimal exact", async () => {
    const [pro, business] = await Promise.all([prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "PRO" } }), prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "BUSINESS" } })]);
    const a = await createVerifiedUser({ email: "mensuel@exemple.test" });
    const b = await createVerifiedUser({ email: "annuel@exemple.test" });
    const c = await createVerifiedUser({ email: "impaye@exemple.test" });
    await prisma.subscription.update({ where: { userId: a.id }, data: { planId: pro.id, status: "ACTIVE", billingInterval: "MONTHLY", priceAmount: "29.00" } });
    await prisma.subscription.update({ where: { userId: b.id }, data: { planId: business.id, status: "ACTIVE", billingInterval: "YEARLY", priceAmount: "590.00" } });
    // Tarif de la formule utilisé lorsque Stripe n'a pas encore transmis le montant.
    await prisma.subscription.update({ where: { userId: c.id }, data: { planId: pro.id, status: "PAST_DUE", billingInterval: "MONTHLY", priceAmount: null } });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: a.id } });
    await prisma.subscriptionPayment.create({ data: { subscriptionId: sub.id, stripeInvoiceId: "in_test_1", amount: "34.80", currency: "eur", status: "paid", paidAt: new Date() } });
    await prisma.subscriptionPayment.create({ data: { subscriptionId: sub.id, stripeInvoiceId: "in_test_2", amount: "34.80", currency: "eur", status: "failed" } });

    const m = await saasMetrics();
    // 29 + 590 / 12 + 29 = 107,1666… → 107,17 ; ARR = 1 286,00
    expect(m.mrr).toBe("107.17");
    expect(m.arr).toBe("1286.00");
    expect(m.payingSubscribers).toBe(3);
    expect(m.pastDue).toBe(1);
    expect(m.revenue12m).toBe("34.80");
    expect(m.revenueByMonth).toHaveLength(12);
    expect(m.revenueByMonth.at(-1)?.revenue).toBe("34.80");
    expect(m.byPlan.find((p) => p.key === "BUSINESS")?.mrr).toBe("49.17");
  });
});

describe("comptes clients", () => {
  it("liste et détaille les comptes sans donnée comptable", async () => {
    const list = await listUsers({ q: "titulaire" });
    expect(list.items).toHaveLength(1);
    const detail = await getUserAdmin(ownerId);
    expect(detail.companies).toEqual([expect.objectContaining({ name: "Atelier Surveillé", role: "Propriétaire" })]);
    expect(JSON.stringify(detail)).not.toMatch(/invoice|totalInclTax/i);
  });

  it("suspend un compte avec motif, ferme ses sessions et refuse la connexion", async () => {
    await loginAs(ownerEmail);
    await expectAppError(setUserSuspended(adminId, ownerId, true, "court"), "VALIDATION_ERROR");
    await expectAppError(setUserSuspended(adminId, adminId, true, "Motif suffisamment long"), "SELF_ACTION");
    await setUserSuspended(adminId, ownerId, true, "Fraude au paiement suspectée");
    expect(await prisma.session.count({ where: { userId: ownerId, revokedAt: null } })).toBe(0);
    await expectAppError(login({ email: ownerEmail, password: PASSWORD }), "ACCOUNT_SUSPENDED");
    await setUserSuspended(adminId, ownerId, false, null);
    await expect(loginAs(ownerEmail)).resolves.toBeTruthy();
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: "admin.user_" }, entityId: ownerId } });
    expect(audit.map((a) => a.actorType)).toEqual(["SUPER_ADMIN", "SUPER_ADMIN"]);
  });

  it("refuse de suspendre un autre administrateur", async () => {
    const other = await createVerifiedUser({ email: "admin2@plateforme.test" });
    await prisma.user.update({ where: { id: other.id }, data: { isSuperAdmin: true } });
    await expectAppError(setUserSuspended(adminId, other.id, true, "Motif suffisamment long"), "FORBIDDEN");
  });

  it("prolonge l'essai et change la formule hors Stripe, mais pas un abonnement géré par Stripe", async () => {
    const before = await prisma.subscription.findUniqueOrThrow({ where: { userId: ownerId } });
    await extendTrial(adminId, ownerId, 10, "Geste commercial");
    const after = await prisma.subscription.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(after.trialEndsAt!.getTime() - before.trialEndsAt!.getTime()).toBe(10 * 86400_000);
    await setPlanManually(adminId, ownerId, "BUSINESS", "Essai de la formule Business");
    expect((await getUserAdmin(ownerId)).subscription?.planKey).toBe("BUSINESS");
    await prisma.subscription.update({ where: { userId: ownerId }, data: { stripeSubscriptionId: "sub_gere", status: "ACTIVE" } });
    await expectAppError(extendTrial(adminId, ownerId, 5, "Tentative"), "STRIPE_MANAGED");
    await expectAppError(setPlanManually(adminId, ownerId, "PRO", "Tentative"), "STRIPE_MANAGED");
    await prisma.subscription.update({ where: { userId: ownerId }, data: { stripeSubscriptionId: null, status: "TRIALING" } });
  });
});

describe("entreprises", () => {
  it("suspend une entreprise : ses membres n'y accèdent plus", async () => {
    expect((await listCompanies({ q: "Surveillé" })).items).toHaveLength(1);
    await setCompanyStatus(adminId, companyId, "SUSPENDED", "Vérification d'identité en cours");
    await expectAppError(authorizeCompany(ownerId, companyId, "invoices:read"), "COMPANY_SUSPENDED");
    expect((await getCompanyAdmin(companyId)).suspendedReason).toBe("Vérification d'identité en cours");
    await setCompanyStatus(adminId, companyId, "ACTIVE", null);
    await expect(authorizeCompany(ownerId, companyId, "invoices:read")).resolves.toBeTruthy();
  });
});

describe("accès justifié aux données financières", () => {
  it("exige un motif, borne la durée, prévient le titulaire et journalise chaque consultation", async () => {
    await expectAppError(financialSnapshot(adminId, companyId), "FORBIDDEN");
    await expectAppError(requestAccess(adminId, companyId, { reason: "trop court", hours: 1 }), "VALIDATION_ERROR");
    await expectAppError(requestAccess(adminId, companyId, { reason: "Demande de support SP-123 : écart de TVA", hours: 9 }), "VALIDATION_ERROR");

    const grant = await requestAccess(adminId, companyId, { reason: "Demande de support SP-123 : écart de TVA", hours: 2 });
    expect(lastMailTo(ownerEmail).subject).toContain("Accès du support");
    expect(await prisma.notification.count({ where: { userId: ownerId, type: "admin.data_access" } })).toBe(1);

    const snapshot = await financialSnapshot(adminId, companyId, { ip: "203.0.113.5" });
    expect(snapshot.kpis.revenueFiscalYear).toBe("0.00");
    await financialSnapshot(adminId, companyId);
    const views = await prisma.auditLog.findMany({ where: { action: "admin.financial_data_view", companyId } });
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ actorType: "SUPER_ADMIN", entityId: grant.id });
    expect((await listGrants(companyId))[0]).toMatchObject({ active: true, views: 2 });

    // L'accès est personnel : un autre administrateur ne peut pas s'en servir.
    const other = await prisma.user.findUniqueOrThrow({ where: { email: "admin2@plateforme.test" } });
    await expectAppError(financialSnapshot(other.id, companyId), "FORBIDDEN");

    // Le titulaire révoque : la consultation est aussitôt refusée.
    await revokeGrant(ownerId, grant.id, "owner");
    await expectAppError(financialSnapshot(adminId, companyId), "FORBIDDEN");
    expect((await listGrants(companyId))[0]).toMatchObject({ active: false });
  });

  it("refuse la révocation par un membre d'une autre entreprise", async () => {
    const grant = await requestAccess(adminId, companyId, { reason: "Contrôle demandé par le titulaire (SP-456)", hours: 1 });
    const stranger = await createVerifiedUser({ email: "tiers@exemple.test" });
    await createTestCompany(stranger.id, "Autre Société");
    await expectAppError(revokeGrant(stranger.id, grant.id, "owner"), "NOT_FOUND");
    await revokeGrant(adminId, grant.id, "admin");
  });

  it("n'ouvre plus d'accès une fois expiré", async () => {
    const grant = await requestAccess(adminId, companyId, { reason: "Vérification d'un rapprochement (SP-789)", hours: 1 });
    await prisma.adminDataAccessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectAppError(financialSnapshot(adminId, companyId), "FORBIDDEN");
  });
});

describe("formules", () => {
  it("modifie les tarifs et refuse de retirer la dernière formule proposée", async () => {
    const plans = await listAdminPlans();
    const starter = plans.find((p) => p.key === "STARTER")!;
    const input = planUpdateSchema.parse({ ...starter, monthlyPrice: "12,50", yearlyPrice: "125", limits: { ...starter.limits, maxCompanies: "" } });
    const { plan } = await updatePlan(adminId, starter.id, input);
    expect(plan).toMatchObject({ monthlyPrice: "12.50", yearlyPrice: "125.00", limits: expect.objectContaining({ maxCompanies: null }) });
    for (const p of plans.filter((p) => p.key !== "STARTER")) await prisma.subscriptionPlan.update({ where: { id: p.id }, data: { isActive: false } });
    await expectAppError(updatePlan(adminId, starter.id, { ...input, isActive: false }), "LAST_PLAN");
    await prisma.subscriptionPlan.updateMany({ data: { isActive: true } });
  });

  it("synchronise produit et prix avec Stripe, sans doublon, et archive l'ancien prix", async () => {
    const base = await fake.start();
    Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: base });
    resetEnvCache();
    resetStripeClient();
    const pro = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "PRO" } });
    const first = await syncPlanToStripe(adminId, pro.id);
    expect(first.productId).toMatch(/^prod_/);
    const second = await syncPlanToStripe(adminId, pro.id);
    expect(second).toEqual(first);

    const plan = (await listAdminPlans()).find((p) => p.key === "PRO")!;
    const { stripeSync } = await updatePlan(adminId, pro.id, planUpdateSchema.parse({ ...plan, monthlyPrice: "31" }));
    expect(stripeSync).toMatchObject({ monthlyPriceId: expect.not.stringMatching(first.monthlyPriceId), yearlyPriceId: first.yearlyPriceId });
    const created = fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/prices");
    expect(created.at(-1)?.body).toMatchObject({ unit_amount: "3100", currency: "eur" });
    expect(fake.requests.some((r) => r.method === "POST" && r.path === `/v1/prices/${first.monthlyPriceId}` && r.body.active === "false")).toBe(true);
  });
});

describe("journal d'audit, paramètres, erreurs, supervision", () => {
  it("filtre le journal et neutralise les formules à l'export CSV", async () => {
    await prisma.auditLog.create({ data: { action: "test.injection", actorType: "SYSTEM", metadata: { note: "x" }, entityType: "=HYPERLINK(\"http://x\")" } });
    const page = await listAudit({ actorType: "SUPER_ADMIN" });
    expect(page.items.every((i) => i.actorType === "SUPER_ADMIN")).toBe(true);
    expect(page.total).toBeGreaterThan(5);
    const csv = await exportAuditCsv({ action: "test." });
    expect(csv.startsWith("﻿\"Date\";\"Action\"")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it("journalise la modification d'un paramètre global", async () => {
    await updateSetting("admin.access_grant_max_hours", 4, adminId);
    expect(await prisma.auditLog.count({ where: { action: "admin.setting_update", entityId: "admin.access_grant_max_hours" } })).toBe(1);
    await expectAppError(requestAccess(adminId, companyId, { reason: "Demande de support SP-999 : export FEC", hours: 5 }), "VALIDATION_ERROR");
    await expectAppError(updateSetting("admin.access_grant_max_hours", 500, adminId), "VALIDATION_ERROR");
  });

  it("purge les erreurs anciennes uniquement", async () => {
    await prisma.applicationError.createMany({ data: [{ message: "ancienne", createdAt: new Date(Date.now() - 40 * 86400_000) }, { message: "récente" }] });
    expect(await purgeErrors(adminId)).toEqual({ deleted: 1 });
    expect(await prisma.applicationError.count()).toBe(1);
  });

  it("contrôle réellement les intégrations", async () => {
    const status = await integrationsStatus();
    expect(status.database.ok).toBe(true);
    expect(status.database.migrations).toBeGreaterThan(0);
    expect(status.storage.ok).toBe(true);
    expect(status.stripe).toMatchObject({ configured: true, ok: true, mode: "test", webhookSecret: true });
  });
});
