"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheckIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ValidationResult = { validated: number; errors: Array<{ entryId: string; label: string; message: string }> };

export function reportValidation(result: ValidationResult) {
  if (result.validated > 0) toast.success(`${result.validated} écriture${result.validated > 1 ? "s" : ""} validée${result.validated > 1 ? "s" : ""}.`);
  if (result.errors.length > 0) toast.error(`${result.errors.length} écriture${result.errors.length > 1 ? "s" : ""} non validée${result.errors.length > 1 ? "s" : ""} : ${result.errors[0].label} — ${result.errors[0].message}`);
  if (result.validated === 0 && result.errors.length === 0) toast.info("Aucune écriture du brouillard jusqu'à cette date.");
}

/** Validation de tout le brouillard jusqu'à une date. */
export function ValidateThroughForm({ companyId, defaultDate }: { companyId: string; defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Valider toutes les écritures du brouillard datées jusqu'au ${date.split("-").reverse().join("/")} ? Une écriture validée ne peut plus être modifiée : elle se corrige par contre-passation.`)) return;
    setPending(true);
    try {
      reportValidation(await api<ValidationResult>(`/companies/${companyId}/accounting/entries/validate`, { method: "POST", body: { through: date } }));
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Jusqu'au
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" required />
      </label>
      <Button type="submit" size="sm" className="h-9" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckCheckIcon />} Valider le brouillard
      </Button>
    </form>
  );
}

/** Recalcul des écritures automatiques à partir des pièces. */
export function ResyncButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const result = await api<{ examined: number; changed: number }>(`/companies/${companyId}/accounting/resync`, { method: "POST" });
      toast.success(result.changed > 0 ? `${result.changed} écriture${result.changed > 1 ? "s" : ""} mise${result.changed > 1 ? "s" : ""} à jour sur ${result.examined} pièces.` : `Les écritures automatiques sont à jour (${result.examined} pièces vérifiées).`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <RefreshCwIcon />} Recalculer les écritures automatiques
    </Button>
  );
}
