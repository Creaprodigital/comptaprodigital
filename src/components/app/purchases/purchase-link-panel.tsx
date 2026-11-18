"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, Loader2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import type { PurchaseView } from "@/server/modules/purchases/service";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Suggestion = { purchase: PurchaseView; score: number; reasons: string[] };

/** Rapprochement d'un décaissement avec une facture d'achat à payer. */
export function PurchaseLinkPanel({ companyId, transactionId, linked, suggestions, canWrite, currency }: { companyId: string; transactionId: string; linked: { id: string; label: string; reference: string | null; supplierName: string | null } | null; suggestions: Suggestion[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setBusy(id);
    try {
      await action();
      toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (linked) {
    return (
      <div className="grid gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <CheckIcon className="size-4 text-success-foreground" aria-hidden="true" />
          Règle la facture d'achat
          <Link href={`/app/achats/${linked.id}`} className="font-medium hover:text-primary hover:underline">
            {linked.supplierName ? `${linked.supplierName} — ` : ""}
            {linked.reference ?? linked.label}
          </Link>
        </p>
        {canWrite ? (
          <div>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("unlink", () => api(`/companies/${companyId}/bank/transactions/${transactionId}/purchase`, { method: "DELETE" }), "Rapprochement annulé.")}>
              {busy === "unlink" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <Undo2Icon />} Annuler le rapprochement
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune facture d'achat à payer ne correspond à ce montant. Si la dépense a une facture, <Link href="/app/achats" className="font-medium text-primary hover:underline">saisissez-la dans les achats</Link> ; sinon, une catégorie et un justificatif suffisent.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {suggestions.map(({ purchase, reasons }) => (
        <li key={purchase.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <Link href={`/app/achats/${purchase.id}`} className="font-medium hover:text-primary hover:underline">
              {purchase.supplier?.name ?? "Sans fournisseur"}
              {purchase.reference ? ` — ${purchase.reference}` : ""}
            </Link>
            <p className="text-xs text-muted-foreground">
              {purchase.label} · du {formatDate(purchase.issueDate)} · reste {formatCurrency(purchase.remaining, { currency })}
            </p>
            {reasons.length ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {reasons.map((reason) => (
                  <Badge key={reason} variant="success">{reason}</Badge>
                ))}
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(purchase.id, () => api(`/companies/${companyId}/bank/transactions/${transactionId}/purchase`, { method: "POST", body: { purchaseId: purchase.id } }), "Facture d'achat réglée par cette opération.")} aria-label={`Rapprocher de ${purchase.supplier?.name ?? purchase.label}`}>
              {busy === purchase.id ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon />} Rapprocher
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
