import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TicketThread({ messages, requesterName }: { messages: Array<{ id: string; body: string; isStaff: boolean; createdAt: string }>; requesterName: string }) {
  return (
    <ol className="grid gap-3">
      {messages.map((m) => (
        <li key={m.id} className={cn("max-w-[48rem] rounded-2xl border px-4 py-3 text-sm", m.isStaff ? "border-primary/20 bg-accent" : "bg-card")}>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{m.isStaff ? "Équipe ComptaPro Digital" : requesterName} · {formatDateTime(m.createdAt)}</p>
          <p className="whitespace-pre-line">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
