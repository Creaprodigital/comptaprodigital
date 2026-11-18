"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { EntryView } from "@/server/modules/accounting/entries";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { checkEntryLines } from "@/lib/accounting";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";

type Line = { key: string; accountNumber: string; label: string; debit: string; credit: string; auxiliaryNumber: string };

const toDecimalText = (v: string) => v.replace(/[\s  ]/g, "").replace(",", ".");

/** Saisie d'une écriture d'opérations diverses, avec contrôle d'équilibre en direct. */
export function EntryEditor({
  companyId,
  journals,
  accounts,
  entry,
  today,
}: {
  companyId: string;
  journals: Array<{ id: string; code: string; label: string }>;
  accounts: Array<{ number: string; label: string }>;
  entry?: EntryView;
  today: string;
}) {
  const router = useRouter();
  const counter = useRef(0);
  // Clés déterministes au premier rendu (rendu serveur), puis compteur pour les lignes ajoutées.
  const blank = (key: string, init: Partial<Line> = {}): Line => ({ key, accountNumber: "", label: "", debit: "", credit: "", auxiliaryNumber: "", ...init });
  const newLine = () => blank(`n${counter.current++}`);
  const [lines, setLines] = useState<Line[]>(() =>
    entry
      ? entry.lines.map((l, i) => blank(`i${i}`, { accountNumber: l.accountNumber, label: l.label, debit: l.debit === "0.00" ? "" : l.debit.replace(".", ","), credit: l.credit === "0.00" ? "" : l.credit.replace(".", ","), auxiliaryNumber: l.auxiliaryNumber ?? "" }))
      : [blank("i0"), blank("i1")],
  );
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const usable = lines.filter((l) => l.accountNumber || l.debit || l.credit);
  let check: ReturnType<typeof checkEntryLines> | null = null;
  try {
    check = checkEntryLines(usable.map((l) => ({ accountNumber: l.accountNumber, debit: toDecimalText(l.debit) || "0", credit: toDecimalText(l.credit) || "0" })));
  } catch {
    check = null;
  }
  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const accountLabel = (number: string) => accounts.find((a) => a.number === number)?.label;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      journalId: form.get("journalId"),
      date: form.get("date"),
      label: form.get("label"),
      pieceRef: form.get("pieceRef"),
      lines: usable.map((l) => ({ accountNumber: l.accountNumber, label: l.label, debit: l.debit, credit: l.credit, auxiliaryNumber: l.auxiliaryNumber })),
    };
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = entry
        ? await api<EntryView>(`/companies/${companyId}/accounting/entries/${entry.id}`, { method: "PUT", body })
        : await api<EntryView>(`/companies/${companyId}/accounting/entries`, { method: "POST", body });
      toast.success("Écriture enregistrée au brouillard.");
      setPending(false);
      router.push(`/app/comptabilite/ecritures/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        setErrors(error.fieldErrors);
        const details = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).filter((d) => d.path === "lines" || d.path?.startsWith("lines")).map((d) => d.message) : [];
        if (details.length) setFormError(details.join(" "));
      } else setFormError(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <datalist id="accounts-list">
        {accounts.map((a) => (
          <option key={a.number} value={a.number}>{a.label}</option>
        ))}
      </datalist>
      {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="entry-journal" label="Journal" error={errors.journalId} required>
            <NativeSelect name="journalId" required defaultValue={entry?.journal.id ?? journals.find((j) => j.code === "OD")?.id}>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>{j.code} — {j.label}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="entry-date" label="Date" error={errors.date} required>
            <Input name="date" type="date" required defaultValue={entry?.date ?? today} />
          </Field>
          <Field id="entry-label" label="Libellé" error={errors.label} required>
            <Input name="label" required maxLength={255} defaultValue={entry?.label ?? ""} />
          </Field>
          <Field id="entry-piece" label="Référence de la pièce" error={errors.pieceRef}>
            <Input name="pieceRef" maxLength={100} defaultValue={entry?.pieceRef ?? ""} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-2 py-5">
          <div className="hidden grid-cols-[9rem_1fr_7rem_8rem_8rem_2.5rem] gap-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
            <span>Compte</span><span>Libellé de la ligne</span><span>Auxiliaire</span><span className="text-right">Débit</span><span className="text-right">Crédit</span><span />
          </div>
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-2 gap-2 rounded-xl border p-2 md:grid-cols-[9rem_1fr_7rem_8rem_8rem_2.5rem] md:border-0 md:p-0">
              <div>
                <Input list="accounts-list" value={line.accountNumber} onChange={(e) => update(line.key, { accountNumber: e.target.value.replace(/\s/g, "") })} placeholder="Compte" aria-label={`Compte, ligne ${index + 1}`} className="tabular" />
                {line.accountNumber ? <p className="mt-0.5 truncate px-1 text-xs text-muted-foreground">{accountLabel(line.accountNumber) ?? "Compte inconnu"}</p> : null}
              </div>
              <Input value={line.label} onChange={(e) => update(line.key, { label: e.target.value })} placeholder="Libellé (facultatif)" aria-label={`Libellé, ligne ${index + 1}`} className="col-span-2 md:col-span-1" />
              <Input value={line.auxiliaryNumber} onChange={(e) => update(line.key, { auxiliaryNumber: e.target.value })} placeholder="Auxiliaire" aria-label={`Compte auxiliaire, ligne ${index + 1}`} />
              <Input value={line.debit} onChange={(e) => update(line.key, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} inputMode="decimal" placeholder="Débit" aria-label={`Débit, ligne ${index + 1}`} className="tabular text-right" />
              <Input value={line.credit} onChange={(e) => update(line.key, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} inputMode="decimal" placeholder="Crédit" aria-label={`Crédit, ligne ${index + 1}`} className="tabular text-right" />
              <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))} aria-label={`Supprimer la ligne ${index + 1}`}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, newLine()])}>
              <PlusIcon /> Ajouter une ligne
            </Button>
            <p className="ml-auto text-sm">
              Débit <span className="tabular font-semibold">{check ? formatCurrency(check.totalDebit.toFixed(2)) : "—"}</span> · Crédit <span className="tabular font-semibold">{check ? formatCurrency(check.totalCredit.toFixed(2)) : "—"}</span>
            </p>
            <p className={check?.balanced ? "text-sm font-medium text-success-foreground" : "text-sm font-medium text-warning-foreground"} role="status">
              {check?.balanced ? "Écriture équilibrée" : check && !check.totalDebit.equals(check.totalCredit) ? `Écart de ${formatCurrency(check.totalDebit.minus(check.totalCredit).abs().toFixed(2))}` : "À compléter"}
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !check?.balanced}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          Enregistrer au brouillard
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Annuler</Button>
      </div>
    </form>
  );
}
