"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { NativeSelect } from "@/components/ui/input";
import { PRIORITY_LABELS, STAFF_STATUS_LABELS } from "./labels";


/** Statut et priorité d'une demande, modifiés immédiatement. */
export function TicketControls({ ticketId, status, priority }: { ticketId: string; status: string; priority: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function update(body: Record<string, string>) {
    setBusy(true);
    try {
      await api(`/admin/tickets/${ticketId}`, { method: "PATCH", body });
      toast.success("Demande mise à jour.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <NativeSelect aria-label="Statut" className="h-9 w-52" defaultValue={status} disabled={busy} onChange={(e) => update({ status: e.target.value })}>
        {Object.entries(STAFF_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="Priorité" className="h-9 w-40" defaultValue={priority} disabled={busy} onChange={(e) => update({ priority: e.target.value })}>
        {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>Priorité {label.toLowerCase()}</option>)}
      </NativeSelect>
    </div>
  );
}
