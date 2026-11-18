"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarPlusIcon, Loader2Icon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import type { ClosingCheck } from "@/server/modules/accounting/closing";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function LockPeriodForm({ companyId, fiscalYearId, min, max, defaultDate }: { companyId: string; fiscalYearId: string; min: string; max: string; defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Verrouiller la période jusqu'au ${date.split("-").reverse().join("/")} ? Plus aucune écriture ne pourra y être passée, et ce verrouillage ne peut pas être levé.`)) return;
    setPending(true);
    try {
      await api(`/companies/${companyId}/accounting/fiscal-years/${fiscalYearId}/lock`, { method: "POST", body: { through: date } });
      toast.success("Période verrouillée.");
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
        Verrouiller jusqu'au
        <Input type="date" min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} required className="h-9 w-40" />
      </label>
      <Button type="submit" variant="outline" size="sm" className="h-9" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <LockIcon />} Verrouiller
      </Button>
    </form>
  );
}

export function CloseYearButton({ companyId, fiscalYearId, label }: { companyId: string; fiscalYearId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<ClosingCheck | null>(null);
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setOpen(false));

  async function openDialog() {
    setOpen(true);
    setCheck(null);
    try {
      setCheck(await api<ClosingCheck>(`/companies/${companyId}/accounting/fiscal-years/${fiscalYearId}/close`));
    } catch (error) {
      toast.error(errorMessage(error));
      setOpen(false);
    }
  }

  async function close() {
    setPending(true);
    try {
      const result = await api<{ result: string }>(`/companies/${companyId}/accounting/fiscal-years/${fiscalYearId}/close`, { method: "POST" });
      toast.success(`${label} clôturé. Résultat : ${formatCurrency(result.result)}.`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <ShieldCheckIcon /> Clôturer l'exercice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Clôture — {label}</DialogTitle>
            <DialogDescription>La clôture est définitive : l'exercice est verrouillé, les soldes des comptes de bilan et le résultat sont reportés dans l'exercice suivant (à-nouveaux).</DialogDescription>
          </DialogHeader>
          {!check ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Contrôles en cours…</p>
          ) : check.ready ? (
            <p className="rounded-xl border bg-success-soft px-4 py-3 text-sm">Tous les contrôles sont satisfaits. Résultat de l'exercice : <span className="tabular font-semibold">{formatCurrency(check.result ?? "0")}</span>.</p>
          ) : (
            <ul className="list-disc rounded-xl border bg-warning-soft px-8 py-3 text-sm">
              {check.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button disabled={!check?.ready || pending} onClick={close}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Clôturer définitivement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NextYearButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      await api(`/companies/${companyId}/accounting/fiscal-years`, { method: "POST" });
      toast.success("Exercice suivant créé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CalendarPlusIcon />} Ouvrir l'exercice suivant
    </Button>
  );
}
