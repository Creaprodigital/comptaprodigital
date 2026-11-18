import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listAnnouncements } from "@/server/modules/admin/announcements";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AnnouncementsManager } from "@/components/admin/announcements-manager";

export const metadata: Metadata = { title: "Annonces" };

export default async function AdminAnnouncementsPage() {
  await requireSuperAdmin();
  const announcements = await listAnnouncements();
  return (
    <>
      <PageHeader title="Annonces système" description="Maintenance programmée, incident, nouveauté : trois annonces au plus sont affichées simultanément, les plus importantes d'abord. Les utilisateurs peuvent masquer une annonce d'information." />
      <Card><CardContent className="pt-6"><AnnouncementsManager announcements={announcements} /></CardContent></Card>
    </>
  );
}
