"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageIcon, Loader2Icon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import type { BillingSettingsView } from "@/server/modules/invoicing/settings";
import type { VatRateView } from "@/server/modules/products/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

const MAX_LOGO_BYTES = 500 * 1024;

function LogoCard({ companyId, hasLogo, canEdit }: { companyId: string; hasLogo: boolean; canEdit: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);

  async function upload(file: File) {
    if (!["image/png", "image/jpeg"].includes(file.type)) return toast.error("Format accepté : PNG ou JPEG.");
    if (file.size > MAX_LOGO_BYTES) return toast.error("Le logo doit peser moins de 500 Ko.");
    setPending(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await api(`/companies/${companyId}/logo`, { method: "PUT", body: { mimeType: file.type, dataBase64: btoa(binary) } });
      toast.success("Logo enregistré.");
      setVersion((v) => v + 1);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError && error.code === "VALIDATION_ERROR" ? (Object.values(error.fieldErrors)[0] ?? error.message) : errorMessage(error));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setPending(true);
    try {
      await api(`/companies/${companyId}/logo`, { method: "DELETE" });
      toast.success("Logo supprimé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>Affiché en tête de vos devis et factures. PNG ou JPEG, 500 Ko maximum.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-5">
        <div className="flex h-20 w-44 items-center justify-center overflow-hidden rounded-xl border bg-white p-2">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- image privée servie par l'API authentifiée
            <img src={`/api/v1/companies/${companyId}/logo?v=${version}`} alt="Logo de l'entreprise" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-7 text-slate-300" aria-label="Aucun logo" />
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Choisir un logo" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button type="button" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <UploadIcon aria-hidden="true" />}
              {hasLogo ? "Remplacer" : "Importer un logo"}
            </Button>
            {hasLogo ? (
              <Button type="button" variant="outline" disabled={pending} onClick={remove}>
                <Trash2Icon className="text-destructive-foreground" /> Supprimer
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VatRatesCard({ companyId, vatRates, canEdit, franchise }: { companyId: string; vatRates: VatRateView[]; canEdit: boolean; franchise: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/companies/${companyId}/vat-rates`, { method: "POST", body: { label: form.get("label"), rate: form.get("rate") } });
      toast.success("Taux de TVA ajouté.");
      formElement.reset();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/companies/${companyId}/vat-rates/${id}`, { method: "DELETE" });
      toast.success("Taux de TVA supprimé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taux de TVA</CardTitle>
        <CardDescription>
          {franchise ? "En franchise en base, seule l'absence de TVA est proposée." : "Taux proposés dans le catalogue et les documents. Les taux légaux courants sont fournis."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y">
          {vatRates.map((rate) => (
            <li key={rate.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0">
              <span className="tabular w-16 font-semibold">{Number(rate.rate).toLocaleString("fr-FR")} %</span>
              <span className="min-w-0 flex-1 truncate">{rate.label}</span>
              {rate.isSystem ? (
                <Badge variant="secondary">Standard</Badge>
              ) : canEdit ? (
                <Button variant="ghost" size="icon-sm" onClick={() => remove(rate.id)} aria-label={`Supprimer le taux ${rate.label}`}>
                  <Trash2Icon className="text-destructive-foreground" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit && !franchise ? (
          <form onSubmit={add} noValidate className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_110px_auto] sm:items-start">
            <Field id="vat-label" label="Libellé" error={errors.label}>
              <Input name="label" placeholder="Ex. Taux DOM — 8,5 %" required />
            </Field>
            <Field id="vat-rate" label="Taux (%)" error={errors.rate}>
              <Input name="rate" inputMode="decimal" required />
            </Field>
            <Button type="submit" variant="outline" disabled={pending} className="sm:mt-[22px]">
              <PlusIcon /> Ajouter
            </Button>
            {formError ? <p role="alert" className="text-sm font-medium text-destructive-foreground sm:col-span-3">{formError}</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BillingSettingsForm({
  companyId,
  settings,
  vatRates,
  canEdit,
  franchise,
}: {
  companyId: string;
  settings: BillingSettingsView;
  vatRates: VatRateView[];
  canEdit: boolean;
  franchise: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(settings.remindersEnabled);
  const [ibanEdited, setIbanEdited] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/companies/${companyId}/billing-settings`, {
        method: "PATCH",
        body: {
          invoicePrefix: text("invoicePrefix") || settings.invoicePrefix,
          quotePrefix: text("quotePrefix"),
          creditNotePrefix: text("creditNotePrefix") || settings.creditNotePrefix,
          defaultPaymentTermDays: text("defaultPaymentTermDays"),
          quoteValidityDays: text("quoteValidityDays"),
          latePenaltyRate: text("latePenaltyRate"),
          earlyPaymentDiscountNote: text("earlyPaymentDiscountNote"),
          invoiceFooter: text("invoiceFooter"),
          invoiceAccentColor: text("invoiceAccentColor"),
          rcsCity: text("rcsCity"),
          shareCapital: text("shareCapital"),
          iban: ibanEdited ? text("iban") : "",
          keepIban: !ibanEdited,
          bic: text("bic"),
          remindersEnabled,
          reminderDelaysDays: text("reminderDelaysDays")
            .split(/[\s,;]+/)
            .filter(Boolean),
        },
      });
      toast.success("Paramètres de facturation enregistrés.");
      setIbanEdited(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        setErrors(error.fieldErrors);
        setFormError("Certaines informations sont invalides. Vérifiez les champs signalés.");
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  const delaysError = Object.entries(errors).find(([path]) => path.startsWith("reminderDelaysDays"))?.[1];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <form onSubmit={onSubmit} noValidate className="grid gap-6">
        {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
        <fieldset disabled={!canEdit || pending} className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Numérotation</CardTitle>
              <CardDescription>
                Format : préfixe, année, rang (ex. {settings.invoicePrefix}-2026-0001). La suite est chronologique et continue.
                {settings.prefixesLocked ? " Les préfixes des factures et des avoirs sont verrouillés depuis la première émission." : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <Field id="bs-invoice-prefix" label="Préfixe des factures" error={errors.invoicePrefix}>
                <Input name="invoicePrefix" defaultValue={settings.invoicePrefix} disabled={settings.prefixesLocked} maxLength={6} />
              </Field>
              <Field id="bs-credit-prefix" label="Préfixe des avoirs" error={errors.creditNotePrefix}>
                <Input name="creditNotePrefix" defaultValue={settings.creditNotePrefix} disabled={settings.prefixesLocked} maxLength={6} />
              </Field>
              <Field id="bs-quote-prefix" label="Préfixe des devis" error={errors.quotePrefix}>
                <Input name="quotePrefix" defaultValue={settings.quotePrefix} maxLength={6} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conditions de règlement</CardTitle>
              <CardDescription>Reprises par défaut sur vos documents ; les mentions légales correspondantes sont ajoutées automatiquement.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field id="bs-term" label="Délai de paiement par défaut (jours)" error={errors.defaultPaymentTermDays} hint="60 jours au plus entre professionnels.">
                <Input name="defaultPaymentTermDays" inputMode="numeric" defaultValue={settings.defaultPaymentTermDays} />
              </Field>
              <Field id="bs-validity" label="Validité des devis (jours)" error={errors.quoteValidityDays}>
                <Input name="quoteValidityDays" inputMode="numeric" defaultValue={settings.quoteValidityDays} />
              </Field>
              <Field id="bs-penalty" label="Taux annuel des pénalités de retard (%)" error={errors.latePenaltyRate} hint="Vide : trois fois le taux d'intérêt légal.">
                <Input name="latePenaltyRate" inputMode="decimal" defaultValue={settings.latePenaltyRate.replace(".", ",")} />
              </Field>
              <Field id="bs-escompte" label="Mention d'escompte" error={errors.earlyPaymentDiscountNote} hint="Vide : « Pas d'escompte pour paiement anticipé ».">
                <Input name="earlyPaymentDiscountNote" defaultValue={settings.earlyPaymentDiscountNote} />
              </Field>
              <Field
                id="bs-iban"
                label="IBAN affiché sur les factures"
                error={errors.iban}
                hint={settings.ibanMasked && !ibanEdited ? `Enregistré : ${settings.ibanMasked}. Saisissez un nouvel IBAN pour le remplacer.` : "Chiffré en base ; il n'est jamais réaffiché en entier."}
              >
                <Input name="iban" autoComplete="off" placeholder={settings.ibanMasked ?? "FR76 …"} onChange={() => setIbanEdited(true)} />
              </Field>
              <Field id="bs-bic" label="BIC" error={errors.bic}>
                <Input name="bic" defaultValue={settings.bic} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mentions légales de l'émetteur</CardTitle>
              <CardDescription>Complètent le pied de page de vos documents (forme juridique, capital, RCS).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field id="bs-capital" label="Capital social (€)" error={errors.shareCapital}>
                <Input name="shareCapital" inputMode="decimal" defaultValue={settings.shareCapital.replace(".", ",")} />
              </Field>
              <Field id="bs-rcs" label="Ville d'immatriculation au RCS" error={errors.rcsCity}>
                <Input name="rcsCity" defaultValue={settings.rcsCity} />
              </Field>
              <Field id="bs-footer" label="Mention complémentaire" error={errors.invoiceFooter} className="sm:col-span-2" hint="Ex. adhésion à un organisme de gestion agréé, assurance professionnelle.">
                <Textarea name="invoiceFooter" rows={2} className="min-h-16" defaultValue={settings.invoiceFooter} />
              </Field>
              <Field id="bs-color" label="Couleur d'accent des documents" error={errors.invoiceAccentColor}>
                <Input name="invoiceAccentColor" type="color" defaultValue={settings.invoiceAccentColor} className="h-10 w-24 p-1" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Relances automatiques</CardTitle>
              <CardDescription>Un e-mail de rappel, facture jointe, est envoyé au client lorsqu'une facture reste impayée après son échéance.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={remindersEnabled} onChange={(e) => setRemindersEnabled(e.target.checked)} />
                <span>
                  <span className="font-medium">Activer les relances automatiques</span>
                  <span className="block text-muted-foreground">Seuls les clients disposant d'une adresse e-mail sont relancés. Vous pouvez aussi relancer manuellement depuis chaque facture.</span>
                </span>
              </label>
              <Field id="bs-delays" label="Délais après l'échéance (jours)" error={delaysError} hint="Jusqu'à cinq relances, séparées par des virgules. Ex. 7, 15, 30">
                <Input name="reminderDelaysDays" defaultValue={settings.reminderDelaysDays.join(", ")} disabled={!remindersEnabled} className="max-w-xs" />
              </Field>
            </CardContent>
          </Card>
        </fieldset>

        {canEdit ? (
          <Button type="submit" disabled={pending} className="justify-self-end">
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Enregistrer les paramètres
          </Button>
        ) : null}
      </form>

      <div className="grid content-start gap-6">
        <LogoCard companyId={companyId} hasLogo={settings.hasLogo} canEdit={canEdit} />
        <VatRatesCard companyId={companyId} vatRates={vatRates} canEdit={canEdit} franchise={franchise} />
      </div>
    </div>
  );
}
