import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireAuth } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { getUserTicket, TICKET_STATUS_LABELS } from "@/server/modules/support/service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReplyForm } from "@/components/app/support/support-forms";
import { TicketThread } from "@/components/app/support/thread";

export const metadata: Metadata = { title: "Demande de support" };
export const instant = false;

type Props = { params: Promise<{ ticketId: string }> };

export default async function TicketPage({ params }: Props) {
  const [auth, { ticketId }] = await Promise.all([requireAuth(), params]);
  const ticket = await getUserTicket(auth.user.id, ticketId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link href="/app/support" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Support</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold sm:text-[28px]">{ticket.subject}</h1>
        <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">{ticket.reference} <Badge variant="accent">{TICKET_STATUS_LABELS[ticket.status]}</Badge></p>
      </div>
      <div className="grid gap-6">
        <TicketThread messages={ticket.messages} requesterName="Vous" />
        {ticket.status !== "CLOSED" ? (
          <Card><CardContent className="py-5"><ReplyForm endpoint={`/me/support/${ticket.id}`} /></CardContent></Card>
        ) : (
          <p className="text-sm text-muted-foreground">Cette demande est fermée. Pour une nouvelle question, ouvrez une nouvelle demande.</p>
        )}
      </div>
    </>
  );
}
