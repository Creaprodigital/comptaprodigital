import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listSettings } from "@/server/modules/admin/settings";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingField } from "@/components/admin/settings-form";

export const metadata: Metadata = { title: "Paramètres globaux" };

export default async function AdminSettingsPage() {
  await requireSuperAdmin();
  const settings = await listSettings();
  const groups = [...new Set(settings.map((s) => s.group))];
  return (
    <>
      <PageHeader title="Paramètres globaux" description="Réglages de la plateforme, pris en compte en moins de 30 secondes. Les secrets (clés d'API, mots de passe SMTP) restent dans les variables d'environnement du serveur." />
      <div className="grid gap-6">
        {groups.map((group) => (
          <Card key={group}>
            <CardHeader><CardTitle>{group}</CardTitle></CardHeader>
            <CardContent className="divide-y">
              {settings.filter((s) => s.group === group).map((s) => <SettingField key={s.key} setting={s} />)}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
