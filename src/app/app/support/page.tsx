import type { Metadata } from "next";
import Link from "next/link";
import { getAppContext } from "@/server/auth/guards";
import { getSetting } from "@/server/modules/admin/settings";
import { listUserTickets, TICKET_STATUS_LABELS } from "@/server/modules/support/service";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { NewTicketForm } from "@/components/app/support/support-forms";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const { auth, companies, access } = await getAppContext();
  const [tickets, supportEmail] = await Promise.all([listUserTickets(auth.user.id), getSetting("support.email")]);
  return (
    <>
      <PageHeader title="Support" description={`Une question, un problème ? Écrivez-nous, nous vous répondons ici et par e-mail.${supportEmail ? ` Vous pouvez aussi écrire à ${supportEmail}.` : ""}`} />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Nouvelle demande</CardTitle>
            <CardDescription>L'équipe n'accède jamais à vos données comptables sans votre information : tout accès est justifié, limité dans le temps et vous est notifié.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewTicketForm companies={companies.map((c) => ({ id: c.id, name: c.name }))} defaultCompanyId={access?.company.id ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Vos demandes</CardTitle></CardHeader>
          <CardContent>
            {tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune demande pour l'instant.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {tickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <Link href={`/app/support/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{t.subject}</Link>
                    <Badge variant={t.status === "WAITING_CUSTOMER" ? "warning" : t.status === "RESOLVED" || t.status === "CLOSED" ? "secondary" : "accent"}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                    <p className="w-full text-xs text-muted-foreground">{t.reference} · mis à jour le {formatDateTime(t.updatedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
