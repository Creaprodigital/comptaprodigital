import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { authorizeCompany } from "@/server/rbac/service";
import { resetStripeClient } from "@/server/billing/stripe";
import { changePlan, completeCheckout, getBillingOverview, openBillingPortal, planFitProblems, runTrialJobs, setCancelAtPeriodEnd, startCheckout } from "@/server/billing/service";
import { isCompanyReadOnly, mapStripeStatus, standingOf } from "@/server/billing/standing";
import { processWebhook } from "@/server/billing/webhooks";
import { invalidateSettingsCache, updateSetting } from "@/server/modules/admin/settings";
import { getMemoryOutbox } from "@/server/mail/mailer";
import { FakeStripe } from "../support/fake-stripe";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const SECRET = "whsec_test_comptapro";
const stripe = new Stripe("sk_test_fake");
const fake = new FakeStripe();
const saved = { ...process.env };
let eventCounter = 0;

/** Envoie un événement signé comme le ferait Stripe. */
async function send(type: string, object: unknown, options: { id?: string; secret?: string } = {}) {
  const payload = JSON.stringify({ id: options.id ?? `evt_${++eventCounter}`, object: "event", type, api_version: "2026-10-28.endive", created: Math.floor(Date.now() / 1000), data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? SECRET });
  return processWebhook(payload, header);
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === code, `erreur attendue : ${code}`);
}

let userId: string;
let companyId: string;
let proMonthly: string;
let proYearly: string;
let businessMonthly: string;
let starterMonthly: string;

beforeAll(async () => {
  await resetDatabase();
  const base = await fake.start();
  Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: base });
  resetEnvCache();
  resetStripeClient();
  invalidateSettingsCache();
  proMonthly = fake.addPrice("PRO", "month", 2900);
  proYearly = fake.addPrice("PRO", "year", 29000);
  businessMonthly = fake.addPrice("BUSINESS", "month", 5900);
  starterMonthly = fake.addPrice("STARTER", "month", 900);
  await prisma.subscriptionPlan.update({ where: { key: "PRO" }, data: { stripeMonthlyPriceId: proMonthly, stripeYearlyPriceId: proYearly } });
  await prisma.subscriptionPlan.update({ where: { key: "BUSINESS" }, data: { stripeMonthlyPriceId: businessMonthly } });
  await prisma.subscriptionPlan.update({ where: { key: "STARTER" }, data: { stripeMonthlyPriceId: starterMonthly } });
  const user = await createVerifiedUser({ email: "abonne@exemple.test", plan: "PRO", firstName: "Lina" });
  userId = user.id;
  companyId = (await createTestCompany(userId, "Atelier Abonné")).id;
});

afterAll(async () => {
  await fake.stop();
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_BASE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  resetStripeClient();
  invalidateSettingsCache();
});

describe("règles d'abonnement", () => {
  it("détermine la situation d'un abonnement", () => {
    const future = new Date(Date.now() + 86400_000);
    const past = new Date(Date.now() - 1000);
    expect(standingOf({ status: "TRIALING", trialEndsAt: future })).toBe("trial");
    expect(standingOf({ status: "TRIALING", trialEndsAt: past })).toBe("inactive");
    expect(standingOf({ status: "ACTIVE", trialEndsAt: null })).toBe("active");
    expect(standingOf({ status: "PAST_DUE", trialEndsAt: null })).toBe("grace");
    expect(standingOf({ status: "CANCELED", trialEndsAt: null })).toBe("inactive");
    expect(standingOf(null)).toBe("inactive");
    expect(["trialing", "active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"].map(mapStripeStatus)).toEqual(["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID", "CANCELED", "INCOMPLETE", "EXPIRED", "EXPIRED"]);
  });
});

describe("souscription par Stripe Checkout", () => {
  let sessionId: string;

  it("présente l'essai en cours et les formules disponibles", async () => {
    const overview = await getBillingOverview(userId);
    expect(overview).toMatchObject({ stripeEnabled: true, standing: "trial", subscription: { planKey: "PRO", status: "TRIALING", managedByStripe: false } });
    expect(overview.plans.find((p) => p.key === "PRO")).toMatchObject({ monthlyAvailable: true, yearlyAvailable: true, fitProblems: [] });
    expect(overview.plans.find((p) => p.key === "BUSINESS")).toMatchObject({ monthlyAvailable: true, yearlyAvailable: false });
  });

  it("ouvre une page de paiement en conservant l'essai restant", async () => {
    const { url } = await startCheckout(userId, "PRO", "MONTHLY");
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const request = fake.requests.find((r) => r.path === "/v1/checkout/sessions")!;
    expect(request.body).toMatchObject({ mode: "subscription", client_reference_id: userId, line_items: [{ price: proMonthly, quantity: "1" }], locale: "fr" });
    expect(Number((request.body.subscription_data as Record<string, string>).trial_end)).toBeGreaterThan(Date.now() / 1000);
    expect(String(request.body.success_url)).toContain("session_id={CHECKOUT_SESSION_ID}");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(subscription.stripeCustomerId).toMatch(/^cus_/);
    sessionId = [...fake.sessions.keys()][0];
    await expectAppError(startCheckout(userId, "INCONNUE", "MONTHLY"), "VALIDATION_ERROR");
  });

  it("active l'abonnement au retour de paiement et par le webhook signé", async () => {
    const sub = fake.completeSession(sessionId, "active");
    await completeCheckout(userId, sessionId);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(after).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: sub.id, billingInterval: "MONTHLY", cancelAtPeriodEnd: false });
    expect(after.priceAmount?.toFixed(2)).toBe("29.00");
    expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    // Le webhook (rejoué) aboutit au même état.
    expect(await send("checkout.session.completed", { id: sessionId, object: "checkout.session", mode: "subscription", client_reference_id: userId, subscription: sub.id })).toEqual({ received: true });
    expect((await getBillingOverview(userId)).standing).toBe("active");
    await expectAppError(startCheckout(userId, "PRO", "MONTHLY"), "ALREADY_SUBSCRIBED");
  });

  it("refuse les webhooks non signés ou altérés, ignore les doublons", async () => {
    const payload = JSON.stringify({ id: "evt_x", type: "invoice.paid", data: { object: {} } });
    await expectAppError(processWebhook(payload, null), "INVALID_SIGNATURE");
    await expectAppError(processWebhook(payload, "t=1,v1=deadbeef"), "INVALID_SIGNATURE");
    await expectAppError(send("invoice.paid", {}, { secret: "whsec_autre" }), "INVALID_SIGNATURE");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    const invoice = { id: "in_1", object: "invoice", customer: sub.stripeCustomerId, status: "paid", currency: "eur", amount_paid: 2900, amount_due: 2900, status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, hosted_invoice_url: "https://invoice.stripe.test/in_1", invoice_pdf: "https://invoice.stripe.test/in_1.pdf", parent: { type: "subscription_details", subscription_details: { subscription: sub.stripeSubscriptionId, metadata: {} } } };
    expect(await send("invoice.paid", invoice, { id: "evt_paid_1" })).toEqual({ received: true });
    expect(await send("invoice.paid", invoice, { id: "evt_paid_1" })).toEqual({ received: true, duplicate: true });
    expect(await send("charge.refunded", {})).toEqual({ received: true, ignored: true });
    const payments = (await getBillingOverview(userId)).payments;
    expect(payments).toEqual([expect.objectContaining({ amount: "29.00", status: "paid", hostedInvoiceUrl: "https://invoice.stripe.test/in_1", invoicePdfUrl: "https://invoice.stripe.test/in_1.pdf" })]);
  });
});

describe("vie de l'abonnement", () => {
  it("signale un échec de paiement, laisse un délai de grâce, puis rétablit", async () => {
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    const failed = { id: "in_2", object: "invoice", customer: sub.stripeCustomerId, status: "open", currency: "eur", amount_paid: 0, amount_due: 2900, status_transitions: { paid_at: null }, parent: { type: "subscription_details", subscription_details: { subscription: sub.stripeSubscriptionId, metadata: {} } } };
    await send("invoice.payment_failed", failed);
    fake.subscriptions.get(sub.stripeSubscriptionId!)!.status = "past_due";
    await send("customer.subscription.updated", { id: sub.stripeSubscriptionId, object: "subscription", metadata: {} });
    const overview = await getBillingOverview(userId);
    expect(overview).toMatchObject({ standing: "grace", subscription: { status: "PAST_DUE" } });
    expect(overview.subscription!.paymentFailedAt).not.toBeNull();
    expect(getMemoryOutbox().some((m) => m.to === "abonne@exemple.test" && m.subject.startsWith("Échec du paiement"))).toBe(true);
    expect(await prisma.notification.count({ where: { userId, type: "billing.payment_failed" } })).toBe(1);
    expect(await isCompanyReadOnly(companyId)).toBe(false); // délai de grâce : accès complet

    fake.subscriptions.get(sub.stripeSubscriptionId!)!.status = "active";
    await send("invoice.paid", { ...failed, status: "paid", amount_paid: 2900, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
    await send("customer.subscription.updated", { id: sub.stripeSubscriptionId, object: "subscription", metadata: {} });
    expect((await getBillingOverview(userId)).subscription).toMatchObject({ status: "ACTIVE", paymentFailedAt: null });
  });

  it("change de formule au prorata et refuse une formule trop petite", async () => {
    await changePlan(userId, "BUSINESS", "MONTHLY");
    const update = fake.requests.filter((r) => r.method === "POST" && r.path.startsWith("/v1/subscriptions/")).at(-1)!;
    expect(update.body).toMatchObject({ proration_behavior: "create_prorations", items: [{ price: businessMonthly }] });
    expect((await getBillingOverview(userId)).subscription).toMatchObject({ planKey: "BUSINESS", priceAmount: "59.00" });
    await createTestCompany(userId, "Deuxième atelier");
    expect(await planFitProblems(userId, (await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "STARTER" } })))).toEqual([expect.stringContaining("vous en détenez 2")]);
    await expectAppError(changePlan(userId, "STARTER", "MONTHLY"), "PLAN_LIMIT_EXCEEDED");
  });

  it("résilie en fin de période, puis reprend", async () => {
    await setCancelAtPeriodEnd(userId, true);
    expect((await getBillingOverview(userId)).subscription).toMatchObject({ cancelAtPeriodEnd: true, status: "ACTIVE" });
    await setCancelAtPeriodEnd(userId, false);
    expect((await getBillingOverview(userId)).subscription?.cancelAtPeriodEnd).toBe(false);
    expect((await openBillingPortal(userId)).url).toBe("https://billing.stripe.test/session");
  });

  it("passe l'entreprise en lecture seule une fois l'abonnement terminé", async () => {
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    const stripeSub = fake.subscriptions.get(sub.stripeSubscriptionId!)!;
    await send("customer.subscription.deleted", { ...stripeSub, status: "canceled", ended_at: Math.floor(Date.now() / 1000) });
    expect((await getBillingOverview(userId)).standing).toBe("inactive");
    expect(await isCompanyReadOnly(companyId)).toBe(true);
    // Consultation et export restent possibles, pas les modifications.
    await expect(authorizeCompany(userId, companyId, "invoices:read")).resolves.toBeTruthy();
    await expect(authorizeCompany(userId, companyId, "exports:run")).resolves.toBeTruthy();
    await expectAppError(authorizeCompany(userId, companyId, "invoices:write"), "SUBSCRIPTION_INACTIVE");
    // Paramètre « off » : aucune restriction.
    await updateSetting("billing.enforcement", "off", userId);
    await expect(authorizeCompany(userId, companyId, "invoices:write")).resolves.toBeTruthy();
    await updateSetting("billing.enforcement", "auto", userId);
    // Une nouvelle souscription est possible.
    expect((await startCheckout(userId, "BUSINESS", "MONTHLY")).url).toMatch(/^https:/);
  });
});

describe("essais", () => {
  it("prévient avant la fin de l'essai, une seule fois, puis clôt les essais échus", async () => {
    const trial = await createVerifiedUser({ email: "essai@exemple.test", plan: "STARTER" });
    await prisma.subscription.update({ where: { userId: trial.id }, data: { trialEndsAt: new Date(Date.now() + 2 * 86400_000) } });
    expect(await runTrialJobs()).toMatchObject({ reminded: 1 });
    expect(await runTrialJobs()).toMatchObject({ reminded: 0 });
    expect(getMemoryOutbox().filter((m) => m.to === "essai@exemple.test" && m.subject.startsWith("Votre essai se termine"))).toHaveLength(1);
    await prisma.subscription.update({ where: { userId: trial.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    expect((await runTrialJobs()).expired).toBe(1);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: trial.id } })).status).toBe("EXPIRED");
  });
});
