"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { CategorySuggestionView } from "@/server/ai/categorization";
import type { CategoryView } from "@/server/modules/bank/categories";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategorySelect } from "@/components/app/bank/category-select";

const CONFIDENCE = { low: { label: "Faible", variant: "secondary" }, medium: { label: "Moyenne", variant: "accent" }, high: { label: "Élevée", variant: "success" } } as const;
const VAT_RATES = ["20.00", "10.00", "5.50", "2.10", "0.00"];

export function RequestSuggestionsButton({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const result = await api<{ requested: number; suggested: number }>(`/companies/${companyId}/bank/ai-suggestions`, { method: "POST", body: {} });
      toast.success(result.requested === 0 ? "Aucune opération à catégoriser." : `${result.suggested} suggestion(s) pour ${result.requested} opération(s) examinée(s).`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button type="button" onClick={run} disabled={pending || disabled}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SparklesIcon />} Proposer des catégories
    </Button>
  );
}

/** Suggestions en attente : chacune est acceptée (éventuellement corrigée) ou rejetée par l'utilisateur. */
export function CategorySuggestions({ companyId, suggestions, categories, canWrite }: { companyId: string; suggestions: CategorySuggestionView[]; categories: CategoryView[]; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { categoryId: string; vatRate: string }>>({});

  async function decide(ids: string[], decision: "accept" | "reject", key: string, override?: { categoryId: string; vatRate: string }) {
    setBusy(key);
    try {
      const body = { ids, decision, ...(override ? { categoryId: override.categoryId || null, vatRate: override.vatRate || null } : {}) };
      const result = await api<{ accepted: number; rejected: number }>(`/companies/${companyId}/bank/ai-suggestions/decision`, { method: "POST", body });
      toast.success(decision === "accept" ? `${result.accepted} opération(s) catégorisée(s).` : `${result.rejected} suggestion(s) écartée(s).`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const confident = suggestions.filter((s) => s.confidence === "high" && !overrides[s.id]);
  return (
    <>
      {canWrite && confident.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <span>{confident.length} suggestions à confiance élevée. Vérifiez-les dans la liste avant de les accepter ensemble.</span>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(confident.map((s) => s.id), "accept", "all")}>
            {busy === "all" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />} Accepter ces {confident.length} suggestions
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opération</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Catégorie proposée</TableHead>
              <TableHead>TVA</TableHead>
              <TableHead>Confiance</TableHead>
              {canWrite ? <TableHead className="text-right">Décision</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {suggestions.map((s) => {
              const value = overrides[s.id] ?? { categoryId: s.category?.id ?? "", vatRate: s.vatRate ?? "" };
              const edited = Boolean(overrides[s.id]);
              return (
                <TableRow key={s.id}>
                  <TableCell className="max-w-xs">
                    <Link href={`/app/banque/operations/${s.transaction.id}`} className="font-medium hover:text-primary hover:underline">{s.transaction.label}</Link>
                    <span className="block text-xs text-muted-foreground">{formatDate(s.transaction.date)} · {s.reason}</span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{formatCurrency(s.transaction.amount)}</TableCell>
                  <TableCell className="min-w-48">
                    <CategorySelect aria-label={`Catégorie pour ${s.transaction.label}`} categories={categories} value={value.categoryId} disabled={!canWrite} onChange={(e) => setOverrides((o) => ({ ...o, [s.id]: { ...value, categoryId: e.target.value } }))} className="h-9" />
                  </TableCell>
                  <TableCell>
                    <NativeSelect aria-label={`TVA pour ${s.transaction.label}`} value={value.vatRate} disabled={!canWrite} onChange={(e) => setOverrides((o) => ({ ...o, [s.id]: { ...value, vatRate: e.target.value } }))} className="h-9 w-28">
                      <option value="">Sans</option>
                      {VAT_RATES.map((r) => <option key={r} value={r}>{r.replace(".", ",").replace(",00", "")} %</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Badge variant={CONFIDENCE[s.confidence].variant}>{CONFIDENCE[s.confidence].label}</Badge>
                    {edited ? <span className="block text-xs text-muted-foreground">modifiée</span> : null}
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null || !value.categoryId} onClick={() => decide([s.id], "accept", s.id, edited ? value : undefined)} aria-label={`Accepter pour ${s.transaction.label}`}>
                        {busy === s.id ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />} Accepter
                      </Button>{" "}
                      <Button type="button" size="icon-sm" variant="ghost" disabled={busy !== null} onClick={() => decide([s.id], "reject", `${s.id}-r`)} aria-label={`Écarter la suggestion pour ${s.transaction.label}`}>
                        <XIcon />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
