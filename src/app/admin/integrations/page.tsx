import type { Metadata } from "next";
import { CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { integrationsStatus } from "@/server/modules/admin/integrations";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Intégrations" };

function State({ ok, configured }: { ok: boolean; configured: boolean }) {
  if (!configured) return <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><CircleDashedIcon className="size-4" aria-hidden="true" /> Non configuré</span>;
  return ok ? (
    <span className="flex items-center gap-1.5 text-sm text-success-foreground"><CheckCircle2Icon className="size-4" aria-hidden="true" /> Opérationnel</span>
  ) : (
    <span className="flex items-center gap-1.5 text-sm text-destructive"><XCircleIcon className="size-4" aria-hidden="true" /> À vérifier</span>
  );
}

function Block({ title, check, children }: { title: string; check: { ok: boolean; configured: boolean; detail: string; error?: string }; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <State ok={check.ok} configured={check.configured} />
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p>{check.detail}</p>
        {check.error ? <p className="rounded-lg bg-destructive-soft px-3 py-2 text-xs">{check.error}</p> : null}
        {children}
      </CardContent>
    </Card>
  );
}

export default async function AdminIntegrationsPage() {
  await requireSuperAdmin();
  const s = await integrationsStatus();
  return (
    <>
      <PageHeader
        title="Intégrations"
        description={`Contrôles réels effectués le ${formatDateTime(s.checkedAt)} : requête en base, appel à l'API Stripe, connexion SMTP, écriture puis lecture d'un objet de stockage.`}
        actions={<Button asChild variant="outline" size="sm"><a href="/admin/integrations">Relancer les contrôles</a></Button>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Base de données" check={s.database}>
          <p className="text-muted-foreground">{s.database.migrations} migration(s) appliquée(s){s.database.lastMigration ? `, dernière : ${s.database.lastMigration}` : ""}</p>
        </Block>
        <Block title="Stripe (abonnements)" check={s.stripe}>
          <dl className="grid grid-cols-[11rem_1fr] gap-y-1 text-muted-foreground">
            <dt>Mode</dt><dd>{s.stripe.mode === "live" ? "Production" : s.stripe.mode === "test" ? "Test" : "—"}</dd>
            <dt>Secret de webhook</dt><dd>{s.stripe.webhookSecret ? "Configuré" : "Manquant"}</dd>
            <dt>Dernier événement reçu</dt><dd>{s.stripe.lastEvent ? `${s.stripe.lastEvent.type} — ${formatDateTime(s.stripe.lastEvent.at)}` : "Aucun"}</dd>
            <dt>Formules synchronisées</dt><dd>{s.stripe.syncedPlans}</dd>
          </dl>
        </Block>
        <Block title="E-mails (SMTP)" check={s.smtp} />
        <Block title="Stockage des documents" check={s.storage} />
        <Block title="Assistant IA (Anthropic)" check={s.ai}>
          <p className="text-muted-foreground">30 derniers jours : {s.ai.requests30d} requête(s), {s.ai.tokens30d.toLocaleString("fr-FR")} jetons, {s.ai.errors30d} erreur(s)</p>
        </Block>
        <Block title="Synchronisation bancaire (Bridge)" check={s.bankSync}>
          <p className="text-muted-foreground">
            {s.bankSync.active} connexion(s) active(s), dont {s.bankSync.actionRequired} en attente d'une action de l'utilisateur
            {s.bankSync.lastSyncAt ? ` · dernière synchronisation le ${new Date(s.bankSync.lastSyncAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` : ""}
          </p>
        </Block>
        <Block title="Annuaire des entreprises (Sirene)" check={s.insee} />
        <Block title="Tâches quotidiennes" check={s.dailyJobs} />
      </div>
    </>
  );
}
