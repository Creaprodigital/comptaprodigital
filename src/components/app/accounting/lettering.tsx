"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Decimal from "decimal.js";
import { Link2Icon, Link2OffIcon, Loader2Icon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Amount } from "@/components/app/accounting/shared";

type Line = { id: string; entryId: string; date: string; journal: string; entryNumber: number | null; pieceRef: string | null; label: string; debit: string; credit: string; letter: string | null; draft: boolean };

export function AutoLetterButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const { groups } = await api<{ groups: number }>(`/companies/${companyId}/accounting/lettering`, { method: "POST", body: { auto: true } });
      toast.success(groups > 0 ? `${groups} lettrage${groups > 1 ? "s" : ""} effectué${groups > 1 ? "s" : ""}.` : "Aucun groupe équilibré à lettrer.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <WandSparklesIcon />} Lettrage automatique
    </Button>
  );
}

/** Lignes d'un tiers : sélection de lignes équilibrées pour les lettrer, délettrage. */
export function LetteringTable({ companyId, accountNumber, lines, canWrite, currency }: { companyId: string; accountNumber: string; lines: Line[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setSelected(new Set()));
  const chosen = lines.filter((l) => selected.has(l.id));
  const balance = chosen.reduce((acc, l) => acc.plus(l.debit).minus(l.credit), new Decimal(0));

  async function run(action: () => Promise<unknown>, message: string) {
    setPending(true);
    try {
      await action();
      toast.success(message);
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
      {canWrite && chosen.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border bg-accent px-3 py-2" role="region" aria-label="Lettrage de la sélection">
          <p className="mr-auto text-sm">
            {chosen.length} ligne{chosen.length > 1 ? "s" : ""} · écart <span className="tabular font-semibold">{formatCurrency(balance.toFixed(2))}</span>
          </p>
          <Button size="sm" disabled={pending || !balance.isZero() || chosen.length < 2} onClick={() => run(() => api(`/companies/${companyId}/accounting/lettering`, { method: "POST", body: { lineIds: chosen.map((l) => l.id) } }), "Lignes lettrées.")}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <Link2Icon />} Lettrer
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {canWrite ? <TableHead className="w-8" /> : null}
            <TableHead>Date</TableHead><TableHead>Pièce</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Lettrage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id} className={line.draft ? "text-muted-foreground" : undefined}>
              {canWrite ? (
                <TableCell>
                  {!line.letter && !line.draft ? (
                    <input type="checkbox" className="size-4 accent-primary" checked={selected.has(line.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(line.id)) n.delete(line.id); else n.add(line.id); return n; })} aria-label={`Sélectionner ${line.label}`} />
                  ) : null}
                </TableCell>
              ) : null}
              <TableCell className="tabular whitespace-nowrap">{formatDate(line.date)}</TableCell>
              <TableCell className="text-sm">{line.pieceRef ?? "—"}</TableCell>
              <TableCell className="max-w-[20rem] truncate text-sm">{line.label}{line.draft ? " (brouillard)" : ""}</TableCell>
              <TableCell className="text-right"><Amount value={line.debit} currency={currency} /></TableCell>
              <TableCell className="text-right"><Amount value={line.credit} currency={currency} /></TableCell>
              <TableCell className="text-right">
                {line.letter ? (
                  <span className="inline-flex items-center gap-1">
                    <Badge variant="secondary">{line.letter}</Badge>
                    {canWrite ? (
                      <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => run(() => api(`/companies/${companyId}/accounting/lettering?account=${accountNumber}&letter=${line.letter}`, { method: "DELETE" }), "Lettrage retiré.")} aria-label={`Délettrer ${line.letter}`}>
                        <Link2OffIcon />
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
