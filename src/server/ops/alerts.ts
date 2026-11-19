import { prisma } from "@/server/db";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { getSetting } from "@/server/modules/admin/settings";
import { integrationsStatus } from "@/server/modules/admin/integrations";

/**
 * Synthèse quotidienne des incidents, envoyée aux super administrateurs (et à l'adresse du
 * support) par la tâche quotidienne, uniquement s'il y a quelque chose à signaler.
 */

export type AlertLine = { label: string; detail: string };

export async function collectAlerts(now = new Date()): Promise<AlertLine[]> {
  const since = new Date(now.getTime() - 86400_000);
  const [errors, topPaths, cspViolations, failedPayments, staleTickets, status] = await Promise.all([
    prisma.applicationError.count({ where: { createdAt: { gte: since }, NOT: { method: "CSP" } } }),
    prisma.applicationError.groupBy({ by: ["path"], where: { createdAt: { gte: since }, NOT: { method: "CSP" } }, _count: { _all: true }, orderBy: { _count: { path: "desc" } }, take: 3 }),
    prisma.applicationError.count({ where: { createdAt: { gte: since }, method: "CSP" } }),
    prisma.subscriptionPayment.count({ where: { status: "failed", createdAt: { gte: since } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, updatedAt: { lt: new Date(now.getTime() - 48 * 3600_000) } } }),
    integrationsStatus(),
  ]);
  const lines: AlertLine[] = [];
  if (errors) lines.push({ label: `${errors} erreur(s) applicative(s) en 24 h`, detail: topPaths.map((p) => `${p.path ?? "—"} (${p._count._all})`).join(", ") });
  if (cspViolations) lines.push({ label: `${cspViolations} violation(s) de la politique de sécurité du contenu`, detail: "Voir /admin/erreurs : une injection de script a peut-être été bloquée." });
  if (failedPayments) lines.push({ label: `${failedPayments} paiement(s) d'abonnement en échec`, detail: "Voir /admin/abonnements." });
  if (staleTickets) lines.push({ label: `${staleTickets} demande(s) de support sans réponse depuis 48 h`, detail: "Voir /admin/support." });
  for (const [label, check] of [["Base de données", status.database], ["E-mails (SMTP)", status.smtp], ["Stockage", status.storage], ["Stripe", status.stripe], ["Assistant IA", status.ai]] as const) {
    if (check.configured && !check.ok) lines.push({ label: `${label} : à vérifier`, detail: check.error ?? check.detail });
  }
  return lines;
}

export async function sendDailyAlerts(now = new Date()): Promise<{ sent: number; alerts: number }> {
  const alerts = await collectAlerts(now);
  if (alerts.length === 0) return { sent: 0, alerts: 0 };
  const [admins, supportEmail] = await Promise.all([prisma.user.findMany({ where: { isSuperAdmin: true, status: "ACTIVE" }, select: { email: true } }), getSetting("support.email")]);
  const recipients = [...new Set([...admins.map((a) => a.email), ...(supportEmail ? [supportEmail] : [])])];
  for (const to of recipients) await sendMail(mailTemplates.adminAlerts(to, alerts));
  return { sent: recipients.length, alerts: alerts.length };
}
