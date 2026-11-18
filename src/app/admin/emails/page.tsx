import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listSettings } from "@/server/modules/admin/settings";
import { verifySmtp } from "@/server/mail/mailer";
import { env } from "@/server/env";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingField, TestEmailForm } from "@/components/admin/settings-form";

export const metadata: Metadata = { title: "E-mails" };

export default async function AdminEmailsPage() {
  const auth = await requireSuperAdmin();
  const [settings, smtp] = await Promise.all([listSettings(), verifySmtp()]);
  const config = env();
  return (
    <>
      <PageHeader title="E-mails" description="Configuration des e-mails transactionnels (vérification d'adresse, factures, relances, support, abonnement)." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Serveur d'envoi {smtp.configured ? (smtp.ok ? <Badge variant="success">Connecté</Badge> : <Badge variant="destructive">Injoignable</Badge>) : <Badge variant="warning">Non configuré</Badge>}
            </CardTitle>
            <CardDescription>
              Le serveur SMTP et l'adresse d'envoi se règlent par variables d'environnement (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM), afin de rester cohérents avec les enregistrements SPF et DKIM du domaine.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
              <dt className="text-muted-foreground">Serveur</dt><dd>{config.SMTP_HOST ? `${config.SMTP_HOST}:${config.SMTP_PORT}${config.SMTP_SECURE ? " (TLS)" : ""}` : "—"}</dd>
              <dt className="text-muted-foreground">Adresse d'envoi</dt><dd>{config.MAIL_FROM}</dd>
            </dl>
            {smtp.error ? <p className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3">{smtp.error}</p> : null}
            <TestEmailForm defaultTo={auth.user.email} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Présentation des e-mails</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {settings.filter((s) => s.group === "E-mails").map((s) => <SettingField key={s.key} setting={s} />)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
