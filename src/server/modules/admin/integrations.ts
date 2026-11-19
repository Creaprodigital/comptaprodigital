import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { getStripe, isStripeConfigured, stripeMode } from "@/server/billing/stripe";
import { verifySmtp } from "@/server/mail/mailer";
import { storage } from "@/server/storage";
import { aiModel, getAnthropic } from "@/server/ai/client";

/**
 * Supervision des intégrations : chaque contrôle est réel (requête à la base,
 * appel à l'API Stripe, connexion SMTP, écriture/lecture/suppression d'un objet).
 * Aucun secret n'est renvoyé : seulement l'état et un message d'erreur éventuel.
 */

type Check = { ok: boolean; configured: boolean; detail: string; error?: string };

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> {
  const start = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - start };
  } catch (error) {
    return { ms: Date.now() - start, error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

async function databaseCheck(): Promise<Check & { migrations: number; lastMigration: string | null }> {
  const ping = await timed(() => prisma.$queryRaw`SELECT 1`);
  const migrations = await timed(() => prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC`);
  const rows = migrations.value ?? [];
  const pending = rows.filter((r) => !r.finished_at).length;
  return {
    ok: !ping.error && pending === 0,
    configured: true,
    detail: ping.error ? "Base injoignable" : `Réponse en ${ping.ms} ms${pending ? ` — ${pending} migration(s) inachevée(s)` : ""}`,
    error: ping.error,
    migrations: rows.length,
    lastMigration: rows[0]?.migration_name ?? null,
  };
}

async function stripeCheck(): Promise<Check & { mode: string | null; webhookSecret: boolean; lastEvent: { type: string; at: string } | null; syncedPlans: number }> {
  const [lastEvent, syncedPlans] = await Promise.all([
    prisma.stripeEvent.findFirst({ orderBy: { processedAt: "desc" } }),
    prisma.subscriptionPlan.count({ where: { isActive: true, stripeMonthlyPriceId: { not: null }, stripeYearlyPriceId: { not: null } } }),
  ]);
  const base = { mode: stripeMode(), webhookSecret: Boolean(env().STRIPE_WEBHOOK_SECRET), lastEvent: lastEvent ? { type: lastEvent.type, at: lastEvent.processedAt.toISOString() } : null, syncedPlans };
  const stripe = getStripe();
  if (!stripe || !isStripeConfigured()) return { ...base, ok: false, configured: false, detail: "Non configuré : les abonnements restent en essai et ne sont pas facturés." };
  const call = await timed(() => stripe.products.list({ limit: 1 }));
  return { ...base, ok: !call.error && base.webhookSecret, configured: true, detail: call.error ? "Appel à l'API refusé" : `API joignable (${call.ms} ms)${base.webhookSecret ? "" : " — secret de webhook manquant"}`, error: call.error };
}

async function smtpCheck(): Promise<Check> {
  const result = await verifySmtp();
  if (!result.configured) return { ok: false, configured: false, detail: "Non configuré : les e-mails sont conservés en mémoire (développement uniquement)." };
  return { ok: result.ok, configured: true, detail: result.ok ? `Connexion SMTP à ${env().SMTP_HOST} établie` : "Connexion SMTP impossible", error: result.error };
}

async function storageCheck(): Promise<Check> {
  const key = `healthcheck/${randomUUID()}`;
  const payload = Buffer.from("sonde");
  const probe = await timed(async () => {
    await storage().put(key, payload);
    const back = await storage().get(key);
    await storage().delete(key);
    if (!back || !back.equals(payload)) throw new Error("Lecture de l'objet de test incohérente");
  });
  return { ok: !probe.error, configured: true, detail: probe.error ? "Écriture ou lecture impossible" : `${env().STORAGE_DRIVER === "s3" ? "Stockage objet S3" : "Disque local"} : écriture, lecture et suppression en ${probe.ms} ms`, error: probe.error };
}

async function aiCheck(): Promise<Check & { model: string; requests30d: number; errors30d: number; tokens30d: number }> {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [usage, failed] = await Promise.all([
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    prisma.aiUsage.count({ where: { createdAt: { gte: since }, status: "ERROR" } }),
  ]);
  const base = { model: aiModel(), requests30d: usage._count._all, errors30d: failed, tokens30d: (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0) };
  const client = getAnthropic();
  if (!client) return { ...base, ok: false, configured: false, detail: "Non configuré : l'assistant IA est masqué." };
  // Consultation du modèle : appel gratuit qui vérifie la clé et la disponibilité du modèle.
  const call = await timed(() => client.models.retrieve(base.model));
  return { ...base, ok: !call.error, configured: true, detail: call.error ? "Appel à l'API refusé" : `API joignable (${call.ms} ms), modèle ${base.model} disponible`, error: call.error };
}

export async function integrationsStatus() {
  const [database, stripe, smtp, files, ai, lastJob] = await Promise.all([
    databaseCheck(),
    stripeCheck(),
    smtpCheck(),
    storageCheck(),
    aiCheck(),
    prisma.applicationSetting.findUnique({ where: { key: "jobs.daily.last_run" } }),
  ]);
  const job = (lastJob?.value ?? null) as { at?: string; durationMs?: number } | null;
  const jobAge = job?.at ? Date.now() - new Date(job.at).getTime() : null;
  return {
    checkedAt: new Date().toISOString(),
    database,
    stripe,
    smtp,
    storage: files,
    ai,
    insee: { ok: true, configured: Boolean(env().INSEE_API_KEY), detail: env().INSEE_API_KEY ? "Clé d'API Sirene configurée" : "Sans clé : recherche via l'annuaire public des entreprises" },
    dailyJobs: {
      ok: jobAge !== null && jobAge < 36 * 3600_000,
      configured: job !== null,
      detail: job?.at ? `Dernière exécution le ${new Date(job.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (${job.durationMs ?? "?"} ms)` : "Jamais exécutées : planifiez « npm run jobs:daily » (cron quotidien).",
    },
  };
}
export type IntegrationsStatus = Awaited<ReturnType<typeof integrationsStatus>>;
