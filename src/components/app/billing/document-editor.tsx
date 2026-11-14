"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2Icon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { ProductView, VatRateView } from "@/server/modules/products/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { addDays, isIsoDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { FRANCHISE_VAT_MENTION, InvoicingError, OPERATION_CATEGORY_LABELS, RECURRENCE_LABELS, computeDocumentTotals, type DiscountType } from "@/lib/invoicing";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerDialog } from "@/components/app/billing/customer-dialog";

export type EditorLine = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceExclTax: string;
  discountRate: string;
  vatRate: string;
};

export type EditorCustomer = { id: string; name: string; paymentTermDays: number | null };

type Kind = "quote" | "invoice" | "recurring";

export type EditorInitial = {
  id?: string;
  customerId: string;
  issueDate: string;
  secondDate: string; // échéance (facture), validité (devis), fin (récurrence)
  serviceDate: string;
  subject: string;
  notes: string;
  terms: string;
  operationCategory: "SERVICES" | "GOODS" | "MIXED";
  discountType: DiscountType;
  discountValue: string;
  lines: EditorLine[];
  // Récurrence uniquement
  label?: string;
  frequency?: keyof typeof RECURRENCE_LABELS;
  autoIssue?: boolean;
  autoSend?: boolean;
};

type Props = {
  kind: Kind;
  companyId: string;
  currency: string;
  franchise: boolean;
  customers: EditorCustomer[];
  products: ProductView[];
  vatRates: VatRateView[];
  defaults: { paymentTermDays: number; validityDays: number };
  initial: EditorInitial;
  canCreateCustomer: boolean;
};

let lineCounter = 0;
export function newEditorLine(vatRate: string, overrides: Partial<EditorLine> = {}): EditorLine {
  return { key: `l${++lineCounter}`, productId: "", description: "", quantity: "1", unit: "", unitPriceExclTax: "", discountRate: "0", vatRate, ...overrides };
}

/** « 1 234,5 » → « 1234.5 » ; une saisie incomplète vaut zéro pour l'aperçu des totaux. */
function numeric(value: string): string {
  const normalized = value.replace(/[\s  ]/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : "0";
}

const LABELS: Record<Kind, { second: string; terms: string; submitNew: string; submitEdit: string; back: string; endpoint: string }> = {
  quote: { second: "Valable jusqu'au", terms: "Conditions du devis", submitNew: "Créer le devis", submitEdit: "Enregistrer le devis", back: "/app/devis", endpoint: "quotes" },
  invoice: { second: "Échéance", terms: "Conditions de paiement", submitNew: "Enregistrer le brouillon", submitEdit: "Enregistrer le brouillon", back: "/app/factures", endpoint: "invoices" },
  recurring: { second: "Dernière échéance (facultatif)", terms: "", submitNew: "Créer la facture récurrente", submitEdit: "", back: "/app/factures/recurrentes", endpoint: "recurring-invoices" },
};

export function DocumentEditor({ kind, companyId, currency, franchise, customers: initialCustomers, products, vatRates, defaults, initial, canCreateCustomer }: Props) {
  const router = useRouter();
  const labels = LABELS[kind];
  const editing = Boolean(initial.id);
  const defaultVat = franchise ? "0.00" : (vatRates.find((r) => r.isDefault)?.rate ?? vatRates[0]?.rate ?? "20.00");

  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [secondDate, setSecondDate] = useState(initial.secondDate);
  const [secondTouched, setSecondTouched] = useState(editing);
  const [serviceDate, setServiceDate] = useState(initial.serviceDate);
  const [subject, setSubject] = useState(initial.subject);
  const [notes, setNotes] = useState(initial.notes);
  const [terms, setTerms] = useState(initial.terms);
  const [operationCategory, setOperationCategory] = useState(initial.operationCategory);
  const [discountType, setDiscountType] = useState<DiscountType>(initial.discountType);
  const [discountValue, setDiscountValue] = useState(initial.discountValue);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [newEditorLine(defaultVat)]);
  const [label, setLabel] = useState(initial.label ?? "");
  const [frequency, setFrequency] = useState(initial.frequency ?? "MONTHLY");
  const [autoIssue, setAutoIssue] = useState(initial.autoIssue ?? false);
  const [autoSend, setAutoSend] = useState(initial.autoSend ?? false);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Date d'échéance ou de validité proposée, tant que l'utilisateur ne l'a pas saisie lui-même.
  function suggestedSecondDate(date: string, customer: string): string {
    if (kind === "recurring" || !isIsoDate(date)) return "";
    if (kind === "quote") return addDays(date, defaults.validityDays);
    const term = customers.find((c) => c.id === customer)?.paymentTermDays ?? defaults.paymentTermDays;
    return addDays(date, term);
  }
  function changeIssueDate(value: string) {
    setIssueDate(value);
    if (!secondTouched) setSecondDate(suggestedSecondDate(value, customerId));
  }
  function changeCustomer(value: string) {
    setCustomerId(value);
    if (!secondTouched) setSecondDate(suggestedSecondDate(issueDate, value));
  }

  const updateLine = (key: string, patch: Partial<EditorLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));

  function insertProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const line = newEditorLine(defaultVat, {
      productId: product.id,
      description: product.description ? `${product.name}\n${product.description}` : product.name,
      unit: product.unit ?? "",
      unitPriceExclTax: product.unitPriceExclTax.replace(".", ","),
      vatRate: franchise ? "0.00" : product.vatRate,
    });
    setLines((current) => {
      // La première ligne vide est remplacée plutôt que conservée.
      const blank = current.length === 1 && !current[0].description && !current[0].unitPriceExclTax;
      return blank ? [line] : [...current, line];
    });
  }

  const totals = useMemo(() => {
    try {
      return {
        value: computeDocumentTotals(
          lines.map((line) => ({ quantity: numeric(line.quantity), unitPriceExclTax: numeric(line.unitPriceExclTax), discountRate: numeric(line.discountRate), vatRate: numeric(line.vatRate) })),
          kind === "recurring" ? { type: "NONE", value: 0 } : { type: discountType, value: numeric(discountValue) },
        ),
        error: null as string | null,
      };
    } catch (error) {
      return { value: null, error: error instanceof InvoicingError ? error.message : "Totaux incalculables" };
    }
  }, [lines, discountType, discountValue, kind]);

  const money = (value: { toFixed(n: number): string }) => formatCurrency(value.toFixed(2), { currency });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const items = lines.map((line) => ({
      productId: line.productId || null,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceExclTax: line.unitPriceExclTax,
      discountRate: line.discountRate || "0",
      vatRate: line.vatRate,
    }));
    const common = { customerId, subject, notes, items };
    const body =
      kind === "quote"
        ? { ...common, issueDate, validUntil: secondDate, terms, discountType, discountValue: discountValue || "0" }
        : kind === "invoice"
          ? { ...common, issueDate, dueDate: secondDate, serviceDate, paymentTerms: terms, operationCategory, discountType, discountValue: discountValue || "0" }
          : { ...common, label, frequency, nextRunDate: issueDate, endDate: secondDate, autoIssue, autoSend, operationCategory };
    try {
      const path = `/companies/${companyId}/${labels.endpoint}`;
      const saved = editing ? await api<{ id: string }>(`${path}/${initial.id}`, { method: "PATCH", body }) : await api<{ id: string }>(path, { method: "POST", body });
      toast.success(kind === "quote" ? "Devis enregistré." : kind === "invoice" ? "Brouillon enregistré." : "Facture récurrente créée.");
      router.push(kind === "recurring" ? labels.back : `${labels.back}/${saved.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        setErrors(error.fieldErrors);
        setFormError("Certaines informations sont invalides. Vérifiez les champs signalés.");
      } else {
        setFormError(errorMessage(error));
      }
      setPending(false);
    }
  }

  const lineErrors = Object.entries(errors).filter(([path]) => path.startsWith("items"));

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2 text-foreground">{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2">
            <Field id="doc-customer" label="Client" error={errors.customerId} required>
              <NativeSelect value={customerId} onChange={(e) => changeCustomer(e.target.value)} required>
                <option value="">Sélectionner un client</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </NativeSelect>
            </Field>
            {canCreateCustomer ? (
              <button type="button" onClick={() => setCustomerDialogOpen(true)} className="inline-flex items-center gap-1.5 justify-self-start text-sm font-medium text-primary underline-offset-4 hover:underline">
                <UserPlusIcon className="size-4" aria-hidden="true" /> Nouveau client
              </button>
            ) : null}
          </div>
          {kind === "recurring" ? (
            <>
              <Field id="doc-label" label="Libellé de la récurrence" error={errors.label} required className="sm:col-span-2">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Maintenance mensuelle" required />
              </Field>
              <Field id="doc-frequency" label="Périodicité" error={errors.frequency} required>
                <NativeSelect value={frequency} onChange={(e) => setFrequency(e.target.value as keyof typeof RECURRENCE_LABELS)}>
                  {Object.entries(RECURRENCE_LABELS).map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          ) : null}
          <Field id="doc-issue-date" label={kind === "quote" ? "Date du devis" : kind === "invoice" ? "Date d'émission" : "Première échéance"} error={errors.issueDate ?? errors.nextRunDate} required>
            <Input type="date" value={issueDate} onChange={(e) => changeIssueDate(e.target.value)} required />
          </Field>
          <Field id="doc-second-date" label={labels.second} error={errors.dueDate ?? errors.validUntil ?? errors.endDate}>
            <Input type="date" value={secondDate} onChange={(e) => { setSecondDate(e.target.value); setSecondTouched(true); }} />
          </Field>
          {kind === "invoice" ? (
            <Field id="doc-service-date" label="Date de la prestation ou de la livraison" error={errors.serviceDate} hint="Si elle diffère de la date d'émission.">
              <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
            </Field>
          ) : null}
          {kind !== "quote" ? (
            <Field id="doc-category" label="Nature de l'opération" error={errors.operationCategory} required>
              <NativeSelect value={operationCategory} onChange={(e) => setOperationCategory(e.target.value as typeof operationCategory)}>
                {Object.entries(OPERATION_CATEGORY_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field id="doc-subject" label="Objet" error={errors.subject} className="sm:col-span-2 lg:col-span-4">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. Refonte du site vitrine" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Lignes</CardTitle>
          {products.length > 0 ? (
            <NativeSelect aria-label="Insérer un article du catalogue" className="h-9 w-64 max-w-full" value="" onChange={(e) => insertProduct(e.target.value)}>
              <option value="">Insérer un article du catalogue…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </NativeSelect>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {franchise ? <p className="rounded-lg bg-accent px-3 py-2 text-sm">Franchise en base : aucune TVA n'est facturée. Mention portée sur le document : « {FRANCHISE_VAT_MENTION} ».</p> : null}
          {lineErrors.length > 0 ? (
            <ul className="grid gap-1 rounded-lg border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm" role="alert">
              {lineErrors.map(([path, message]) => {
                const index = Number(path.split(".")[1]);
                return <li key={path}>{Number.isInteger(index) ? `Ligne ${index + 1} : ` : ""}{message}</li>;
              })}
            </ul>
          ) : null}

          <ol className="grid gap-3">
            {lines.map((line, index) => {
              const lineTotal = totals.value?.lines[index]?.totalExclTax;
              return (
                <li key={line.key} className="grid gap-3 rounded-xl border bg-muted/30 p-3 lg:grid-cols-[minmax(0,1fr)_84px_84px_112px_84px_128px_112px_36px] lg:items-start">
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-description`} className="text-xs text-muted-foreground">Désignation</Label>
                    <Textarea id={`${line.key}-description`} value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} rows={1} className="min-h-10 py-2" required />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-quantity`} className="text-xs text-muted-foreground">Quantité</Label>
                    <Input id={`${line.key}-quantity`} inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} className="text-right" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-unit`} className="text-xs text-muted-foreground">Unité</Label>
                    <Input id={`${line.key}-unit`} value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-price`} className="text-xs text-muted-foreground">Prix unitaire HT</Label>
                    <Input id={`${line.key}-price`} inputMode="decimal" value={line.unitPriceExclTax} onChange={(e) => updateLine(line.key, { unitPriceExclTax: e.target.value })} className="text-right" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-discount`} className="text-xs text-muted-foreground">Remise %</Label>
                    <Input id={`${line.key}-discount`} inputMode="decimal" value={line.discountRate} onChange={(e) => updateLine(line.key, { discountRate: e.target.value })} className="text-right" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${line.key}-vat`} className="text-xs text-muted-foreground">TVA</Label>
                    <NativeSelect id={`${line.key}-vat`} value={line.vatRate} onChange={(e) => updateLine(line.key, { vatRate: e.target.value })} disabled={franchise}>
                      {vatRates.some((r) => Number(r.rate) === Number(line.vatRate)) ? null : <option value={line.vatRate}>{Number(line.vatRate).toLocaleString("fr-FR")} %</option>}
                      {vatRates.map((rate) => (
                        <option key={rate.id} value={rate.rate}>{Number(rate.rate).toLocaleString("fr-FR")} %</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Total HT</span>
                    <p className="tabular flex h-10 items-center justify-end font-semibold">{lineTotal ? money(lineTotal) : "—"}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="self-end" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label={`Supprimer la ligne ${index + 1}`}>
                    <Trash2Icon className="text-destructive-foreground" />
                  </Button>
                </li>
              );
            })}
          </ol>
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => setLines((current) => [...current, newEditorLine(defaultVat)])}>
            <PlusIcon /> Ajouter une ligne
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>{kind === "recurring" ? "Options" : "Notes et conditions"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {kind === "recurring" ? (
              <div className="grid gap-3 text-sm">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={autoIssue} onChange={(e) => { setAutoIssue(e.target.checked); if (!e.target.checked) setAutoSend(false); }} />
                  <span>
                    <span className="font-medium">Émettre automatiquement</span>
                    <span className="block text-muted-foreground">La facture est numérotée et verrouillée à chaque échéance. Sinon, elle est préparée en brouillon pour relecture.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={autoSend} disabled={!autoIssue} onChange={(e) => setAutoSend(e.target.checked)} />
                  <span>
                    <span className="font-medium">Envoyer automatiquement au client</span>
                    <span className="block text-muted-foreground">Par e-mail, PDF joint, si la fiche du client comporte une adresse.</span>
                  </span>
                </label>
                {errors.autoSend ? <p className="text-xs font-medium text-destructive-foreground">{errors.autoSend}</p> : null}
              </div>
            ) : null}
            <Field id="doc-notes" label="Note au client" error={errors.notes} hint="Affichée sur le document.">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>
            {kind !== "recurring" ? (
              <Field id="doc-terms" label={labels.terms} error={errors.terms ?? errors.paymentTerms} hint={kind === "invoice" ? "Ex. Paiement par virement à 30 jours. Les mentions légales (pénalités, indemnité, escompte) sont ajoutées automatiquement." : "Ex. Acompte de 30 % à la commande."}>
                <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className="min-h-16" />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Totaux</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {kind !== "recurring" ? (
              <div className="grid grid-cols-[1fr_112px] gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="doc-discount-type" className="text-xs text-muted-foreground">Remise globale</Label>
                  <NativeSelect id="doc-discount-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                    <option value="NONE">Aucune</option>
                    <option value="PERCENT">En pourcentage</option>
                    <option value="AMOUNT">En montant HT</option>
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-discount-value" className="text-xs text-muted-foreground">{discountType === "PERCENT" ? "Taux (%)" : "Montant"}</Label>
                  <Input id="doc-discount-value" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} disabled={discountType === "NONE"} className="text-right" aria-invalid={errors.discountValue ? true : undefined} />
                </div>
                {errors.discountValue ? <p className="col-span-2 text-xs font-medium text-destructive-foreground">{errors.discountValue}</p> : null}
              </div>
            ) : null}

            {totals.value ? (
              <dl className="grid gap-2 text-sm" aria-live="polite">
                {totals.value.discountAmount.greaterThan(0) ? (
                  <>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Sous-total HT</dt><dd className="tabular">{money(totals.value.subtotalExclTax)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Remise</dt><dd className="tabular">− {money(totals.value.discountAmount)}</dd></div>
                  </>
                ) : null}
                <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="tabular font-medium">{money(totals.value.totalExclTax)}</dd></div>
                {totals.value.vatBreakdown.map((row) => (
                  <div key={row.rate.toString()} className="flex justify-between">
                    <dt className="text-muted-foreground">TVA {Number(row.rate).toLocaleString("fr-FR")} %</dt>
                    <dd className="tabular">{money(row.vat)}</dd>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between rounded-xl bg-navy px-4 py-3 text-white">
                  <dt className="font-medium">Total TTC</dt>
                  <dd className="tabular font-display text-xl font-bold">{money(totals.value.totalInclTax)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm font-medium text-destructive-foreground" role="alert">{totals.error}</p>
            )}
            <p className="text-xs text-muted-foreground">Aperçu indicatif : les totaux définitifs sont recalculés à l'enregistrement.</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild type="button" variant="outline">
          <Link href={editing ? `${labels.back}/${initial.id}` : labels.back}>Annuler</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {editing ? labels.submitEdit : labels.submitNew}
        </Button>
      </div>

      <CustomerDialog
        companyId={companyId}
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        onSaved={(customer) => {
          setCustomers((current) => [...current, { id: customer.id, name: customer.name, paymentTermDays: customer.paymentTermDays }].sort((a, b) => a.name.localeCompare(b.name, "fr")));
          changeCustomer(customer.id);
          toast.success("Client créé.");
        }}
      />
    </form>
  );
}
