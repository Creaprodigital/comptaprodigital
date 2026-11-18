"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, Loader2Icon, PencilIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import type { EntryView } from "@/server/modules/accounting/entries";
import { api, errorMessage } from "@/lib/api-client";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { Amount, EntryStatusBadge } from "@/components/app/accounting/shared";
import { reportValidation } from "@/components/app/accounting/actions";

export function EntryActions({ companyId, entry, today }: { companyId: string; entry: EntryView; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);
  const [date, setDate] = useState(today);
  useResetOnHide(() => setReversing(false));

  async function run(name: string, action: () => Promise<unknown>, done?: () => void) {
    setBusy(name);
    try {
      await action();
      done?.();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entry.status === "DRAFT" ? (
        <Button
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm("Valider cette écriture ? Elle recevra un numéro définitif et ne pourra plus être modifiée.")) void run("validate", async () => reportValidation(await api(`/companies/${companyId}/accounting/entries/validate`, { method: "POST", body: { ids: [entry.id] } })));
          }}
        >
          {busy === "validate" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />} Valider
        </Button>
      ) : null}
      {entry.editable ? (
        <Button asChild variant="outline">
          <Link href={`/app/comptabilite/ecritures/${entry.id}/modifier`}><PencilIcon /> Modifier</Link>
        </Button>
      ) : null}
      {entry.deletable ? (
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm("Supprimer cette écriture du brouillard ?")) void run("delete", () => api(`/companies/${companyId}/accounting/entries/${entry.id}`, { method: "DELETE" }), () => { toast.success("Écriture supprimée."); router.push("/app/comptabilite/ecritures"); });
          }}
        >
          <Trash2Icon /> Supprimer
        </Button>
      ) : null}
      {entry.status === "VALIDATED" && entry.sourceType === "MANUAL" && !entry.reversedBy && !entry.reversalOf ? (
        <Button variant="outline" onClick={() => setReversing(true)}>
          <Undo2Icon /> Contre-passer
        </Button>
      ) : null}
      <Dialog open={reversing} onOpenChange={setReversing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contre-passer l'écriture n° {entry.number}</DialogTitle>
            <DialogDescription>Une écriture inverse est préparée au brouillard. L'écriture d'origine reste inchangée ; saisissez ensuite, si besoin, l'écriture correcte.</DialogDescription>
          </DialogHeader>
          <Field id="reverse-date" label="Date de la contre-passation" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("reverse", async () => {
                  const reversal = await api<EntryView>(`/companies/${companyId}/accounting/entries/${entry.id}/reverse`, { method: "POST", body: { date } });
                  setReversing(false);
                  toast.success("Contre-passation préparée au brouillard.");
                  router.push(`/app/comptabilite/ecritures/${reversal.id}`);
                })
              }
            >
              {busy === "reverse" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Préparer la contre-passation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Liste d'écritures avec sélection des écritures du brouillard pour validation. */
export function EntriesTable({ companyId, entries, canWrite, currency }: { companyId: string; entries: EntryView[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setSelected(new Set()));
  const drafts = entries.filter((e) => e.status === "DRAFT");
  const ids = drafts.map((e) => e.id).filter((id) => selected.has(id));

  async function validate() {
    if (!window.confirm(`Valider ${ids.length} écriture${ids.length > 1 ? "s" : ""} ? Une écriture validée ne peut plus être modifiée.`)) return;
    setPending(true);
    try {
      reportValidation(await api(`/companies/${companyId}/accounting/entries/validate`, { method: "POST", body: { ids } }));
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {canWrite && ids.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border bg-accent px-3 py-2" role="region" aria-label="Actions sur la sélection">
          <p className="mr-auto text-sm font-medium">{ids.length} écriture{ids.length > 1 ? "s" : ""} sélectionnée{ids.length > 1 ? "s" : ""}</p>
          <Button size="sm" onClick={validate} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />} Valider la sélection
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {canWrite ? (
              <TableHead className="w-8">
                <input type="checkbox" className="size-4 accent-primary" disabled={drafts.length === 0} checked={drafts.length > 0 && ids.length === drafts.length} onChange={() => setSelected(ids.length === drafts.length ? new Set() : new Set(drafts.map((d) => d.id)))} aria-label="Sélectionner tout le brouillard affiché" />
              </TableHead>
            ) : null}
            <TableHead>Date</TableHead>
            <TableHead>Journal</TableHead>
            <TableHead className="hidden sm:table-cell">N°</TableHead>
            <TableHead>Libellé</TableHead>
            <TableHead className="hidden md:table-cell">Statut</TableHead>
            <TableHead className="text-right">Montant</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              {canWrite ? (
                <TableCell>
                  {entry.status === "DRAFT" ? (
                    <input type="checkbox" className="size-4 accent-primary" checked={selected.has(entry.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(entry.id)) n.delete(entry.id); else n.add(entry.id); return n; })} aria-label={`Sélectionner ${entry.label}`} />
                  ) : null}
                </TableCell>
              ) : null}
              <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(entry.date)}</TableCell>
              <TableCell className="font-medium">{entry.journal.code}</TableCell>
              <TableCell className="tabular hidden text-muted-foreground sm:table-cell">{entry.number ?? "—"}</TableCell>
              <TableCell className="max-w-[26rem]">
                <Link href={`/app/comptabilite/ecritures/${entry.id}`} className="block truncate font-medium hover:text-primary hover:underline">{entry.label}</Link>
                <p className="truncate text-xs text-muted-foreground">{entry.pieceRef ?? ""}{entry.reversalOf ? " · contre-passation" : ""}</p>
              </TableCell>
              <TableCell className="hidden md:table-cell"><EntryStatusBadge status={entry.status} /></TableCell>
              <TableCell className="text-right"><Amount value={entry.total} currency={currency} strong /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
