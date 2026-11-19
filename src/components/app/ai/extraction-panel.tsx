"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, ShoppingCartIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import type { ExtractionState } from "@/server/ai/documents";
import type { CategoryView } from "@/server/modules/bank/categories";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/bank";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { CategorySelect } from "@/components/app/bank/category-select";

const CONFIDENCE = { low: "faible", medium: "moyenne", high: "élevée" } as const;

/**
 * Lecture automatique d'un justificatif : lancement, vérification champ par champ,
 * puis — sur action explicite — création de la facture d'achat.
 */
export function ExtractionPanel({
  companyId,
  documentId,
  state,
  categories,
  usable,
  canWrite,
  canCreatePurchase,
  linkedPurchase,
}: {
  companyId: string;
  documentId: string;
  state: ExtractionState;
  categories: CategoryView[];
  usable: boolean;
  canWrite: boolean;
  canCreatePurchase: boolean;
  linkedPurchase: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"read" | "verify" | "purchase" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const e = state.extraction;
  const base = `/companies/${companyId}/documents/${documentId}/extraction`;

  async function run(kind: "read" | "verify" | "purchase", action: () => Promise<unknown>, success: string) {
    setPending(kind);
    setErrors({});
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    void run("verify", () => api(base, { method: "PUT", body }), "Lecture vérifiée.");
  }

  if (!e) {
    return (
      <div className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          {state.status === "FAILED"
            ? "La dernière lecture n'a pas abouti. Vous pouvez réessayer ou saisir les informations manuellement."
            : "L'assistant peut lire ce document (fournisseur, numéro, dates, montants) et proposer une catégorie. Vous vérifiez chaque information avant tout usage."}
        </p>
        {usable && canWrite ? (
          <div>
            <Button type="button" disabled={pending !== null} onClick={() => run("read", () => api(base, { method: "POST" }), "Document lu : vérifiez les informations.")}>
              {pending === "read" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SparklesIcon />} Lire le document
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const readOnly = !canWrite;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {state.verifiedAt ? (
          <Badge variant="success"><CheckCircle2Icon /> Vérifiée le {formatDateTime(state.verifiedAt)}</Badge>
        ) : (
          <Badge variant="warning">À vérifier</Badge>
        )}
        <span className="text-muted-foreground">Lu par l'IA{state.extractedAt ? ` le ${formatDateTime(state.extractedAt)}` : ""} · confiance {CONFIDENCE[e.confidence]}</span>
      </div>
      {e.warnings.length ? (
        <ul className="grid gap-1 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          {e.warnings.map((w) => (
            <li key={w} className="flex gap-2"><AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {w}</li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onVerify} noValidate className="grid gap-4">
        <fieldset disabled={readOnly || pending !== null} className="grid gap-4 sm:grid-cols-2">
          <Field id="ex-type" label="Type de document" error={errors.documentType}>
            <NativeSelect name="documentType" defaultValue={e.documentType}>
              {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>)}
            </NativeSelect>
          </Field>
          <Field id="ex-supplier" label="Fournisseur (émetteur)" error={errors.supplierName}><Input name="supplierName" defaultValue={e.supplierName ?? ""} /></Field>
          <Field id="ex-number" label="Numéro de facture" error={errors.invoiceNumber}><Input name="invoiceNumber" defaultValue={e.invoiceNumber ?? ""} /></Field>
          <Field id="ex-label" label="Objet" error={errors.label}><Input name="label" defaultValue={e.label ?? ""} /></Field>
          <Field id="ex-date" label="Date" error={errors.issueDate}><Input name="issueDate" type="date" defaultValue={e.issueDate ?? ""} /></Field>
          <Field id="ex-due" label="Échéance" error={errors.dueDate}><Input name="dueDate" type="date" defaultValue={e.dueDate ?? ""} /></Field>
          <Field id="ex-ht" label="Total HT (€)" error={errors.totalExclTax}><Input name="totalExclTax" inputMode="decimal" defaultValue={e.totalExclTax ?? ""} /></Field>
          <Field id="ex-vat" label="TVA (€)" error={errors.totalVat} hint={e.totalInclTax ? `TTC lu : ${formatCurrency(e.totalInclTax)}` : undefined}><Input name="totalVat" inputMode="decimal" defaultValue={e.totalVat ?? ""} /></Field>
          <Field id="ex-cat" label="Catégorie" error={errors.categoryId}>
            <CategorySelect name="categoryId" categories={categories} emptyLabel="À choisir" defaultValue={e.suggestedCategoryId ?? ""} />
          </Field>
          <Field id="ex-op" label="Nature de l'achat" error={errors.operationCategory}>
            <NativeSelect name="operationCategory" defaultValue={e.operationCategory ?? "SERVICES"}>
              <option value="SERVICES">Prestations de services</option>
              <option value="GOODS">Biens</option>
              <option value="MIXED">Mixte</option>
            </NativeSelect>
          </Field>
        </fieldset>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending !== null}>
              {pending === "verify" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckCircle2Icon />} {state.verifiedAt ? "Enregistrer les corrections" : "Valider ces informations"}
            </Button>
            {usable ? (
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => run("read", () => api(base, { method: "POST" }), "Document relu : vérifiez les informations.")}>
                {pending === "read" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SparklesIcon />} Relire
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
      {linkedPurchase ? (
        <p className="text-sm">
          Facture d'achat associée : <Link href={`/app/achats/${linkedPurchase.id}`} className="font-medium text-primary hover:underline">{linkedPurchase.label}</Link>
        </p>
      ) : state.verifiedAt && canCreatePurchase && (e.documentType === "PURCHASE_INVOICE" || e.documentType === "RECEIPT") ? (
        <div className="rounded-xl border p-4 text-sm">
          <p className="mb-3 text-muted-foreground">Créez la facture d'achat à partir de ces informations vérifiées. Elle sera enregistrée « à payer » et le document y sera associé ; ses écritures comptables suivent le circuit habituel (brouillard puis validation).</p>
          <Button type="button" variant="outline" disabled={pending !== null} onClick={() => run("purchase", () => api(`${base}/purchase`, { method: "POST" }), "Facture d'achat créée.")}>
            {pending === "purchase" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <ShoppingCartIcon />} Créer la facture d'achat
          </Button>
        </div>
      ) : null}
    </div>
  );
}
