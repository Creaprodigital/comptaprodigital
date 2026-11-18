import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { AppError } from "@/server/http/errors";
import { getTicket } from "@/server/modules/support/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReplyForm } from "@/components/app/support/support-forms";
import { TicketThread } from "@/components/app/support/thread";
import { TicketControls } from "@/components/admin/ticket-controls";
import { STAFF_STATUS_LABELS } from "@/components/admin/labels";

export const metadata: Metadata = { title: "Demande de support" };
export const instant = false;

type Props = { params: Promise<{ ticketId: string }> };

export default async function AdminTicketPage({ params }: Props) {
  const [, { ticketId }] = await Promise.all([requireSuperAdmin(), params]);
  const ticket = await getTicket(ticketId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link href="/admin/support" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Support</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ticket.reference} · {ticket.requester.name}{ticket.requester.email ? ` <${ticket.requester.email}>` : ""}
            {ticket.requester.userId ? <> · <Link href={`/admin/clients/${ticket.requester.userId}`} className="hover:underline">fiche du compte</Link></> : null}
            {ticket.company ? <> · <Link href={`/admin/entreprises/${ticket.company.id}`} className="hover:underline">{ticket.company.name}</Link></> : null}
          </p>
        </div>
        <TicketControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} />
      </div>
      <div className="grid gap-6">
        <TicketThread messages={ticket.messages} requesterName={ticket.requester.name} />
        <Card>
          <CardHeader><CardTitle>Répondre</CardTitle></CardHeader>
          <CardContent>
            <ReplyForm
              endpoint={`/admin/tickets/${ticket.id}`}
              staff
              statuses={["WAITING_CUSTOMER", "IN_PROGRESS", "RESOLVED", "CLOSED"].map((value) => ({ value, label: `Puis : ${STAFF_STATUS_LABELS[value].toLowerCase()}` }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
