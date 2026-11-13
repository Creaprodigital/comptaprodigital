"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheckIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import {
  LEGAL_FORMS,
  LEGAL_FORM_LABELS,
  TAX_REGIMES_BY_LEGAL_FORM,
  TAX_REGIME_LABELS,
  VAT_EXIGIBILITIES,
  VAT_EXIGIBILITY_LABELS,
  VAT_REGIMES,
  VAT_REGIME_LABELS,
  defaultRegimesFor,
  isMicroRegime,
  type LegalFormKey,
  type TaxRegimeKey,
  type VatExigibilityKey,
  type VatRegimeKey,
} from "@/config/legal";
import type { CompanyLookupResult } from "@/server/modules/insee/service";
import type { SerializedCompany } from "@/server/modules/companies/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { monthName } from "@/lib/dates";
import { formatSiren } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";

type FormValues = {
  name: string;
  tradeName: string;
  siren: string;
  siret: string;
  vatNumber: string;
  nafCode: string;
  legalForm: LegalFormKey;
  taxRegime: TaxRegimeKey;
  vatRegime: VatRegimeKey;
  vatExigibility: VatExigibilityKey;
  fiscalYearStartMonth: number;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
};

function initialValues(company?: SerializedCompany): FormValues {
  const defaults = defaultRegimesFor("SASU");
  return {
    name: company?.name ?? "",
    tradeName: company?.tradeName ?? "",
    siren: company?.siren ?? "",
    siret: company?.siret ?? "",
    vatNumber: company?.vatNumber ?? "",
    nafCode: company?.nafCode ?? "",
    legalForm: company?.legalForm ?? "SASU",
    taxRegime: company?.taxRegime ?? defaults.taxRegime,
    vatRegime: company?.vatRegime ?? defaults.vatRegime,
    vatExigibility: company?.vatExigibility ?? "ENCAISSEMENTS",
    fiscalYearStartMonth: company?.fiscalYearStartMonth ?? 1,
    addressLine1: company?.addressLine1 ?? "",
    addressLine2: company?.addressLine2 ?? "",
    postalCode: company?.postalCode ?? "",
    city: company?.city ?? "",
    email: company?.email ?? "",
    phone: company?.phone ?? "",
  };
}

/** Recherche dans le répertoire Sirene : pré-remplit le formulaire, que l'utilisateur vérifie ensuite. */
function CompanySearch({ onSelect }: { onSelect: (result: CompanyLookupResult) => void }) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<CompanyLookupResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 3) {
      setError("Saisissez au moins 3 caractères.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setResults(await api<CompanyLookupResult[]>(`/company-search?q=${encodeURIComponent(query.trim())}`));
    } catch (err) {
      setResults(null);
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-accent p-4">
      <label htmlFor="company-search" className="text-sm font-semibold">
        Rechercher votre entreprise
      </label>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Par SIREN, SIRET ou dénomination — données publiques du répertoire Sirene.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          id="company-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Ex. 552 100 554 ou le nom de votre société"
          autoComplete="off"
        />
        <Button type="button" onClick={search} disabled={pending} className="shrink-0">
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
          Rechercher
        </Button>
      </div>
      <div aria-live="polite">
        {error ? <p className="mt-3 text-sm text-destructive-foreground">{error}</p> : null}
        {results && results.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aucun résultat. Vous pouvez saisir les informations manuellement ci-dessous.</p>
        ) : null}
        {results && results.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {results.map((result) => (
              <li key={`${result.siren}-${result.siret ?? ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(result);
                    setResults(null);
                    setQuery("");
                  }}
                  className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{result.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      SIREN {formatSiren(result.siren)}
                      {result.postalCode || result.city ? ` · ${[result.postalCode, result.city].filter(Boolean).join(" ")}` : ""}
                      {result.active ? "" : " · cessée"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-primary">Utiliser</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function CompanyForm({
  mode,
  company,
  readOnly = false,
  onCancel,
}: {
  mode: "create" | "edit";
  company?: SerializedCompany;
  readOnly?: boolean;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => initialValues(company));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const allowedTaxRegimes = TAX_REGIMES_BY_LEGAL_FORM[values.legalForm];
  const micro = isMicroRegime(values.taxRegime);

  function changeLegalForm(legalForm: LegalFormKey) {
    setValues((v) => {
      const keepTax = TAX_REGIMES_BY_LEGAL_FORM[legalForm].includes(v.taxRegime);
      const defaults = defaultRegimesFor(legalForm);
      const taxRegime = keepTax ? v.taxRegime : defaults.taxRegime;
      return {
        ...v,
        legalForm,
        taxRegime,
        vatRegime: keepTax ? v.vatRegime : defaults.vatRegime,
        fiscalYearStartMonth: isMicroRegime(taxRegime) ? 1 : v.fiscalYearStartMonth,
      };
    });
  }

  function changeTaxRegime(taxRegime: TaxRegimeKey) {
    setValues((v) => ({
      ...v,
      taxRegime,
      vatRegime: isMicroRegime(taxRegime) && !isMicroRegime(v.taxRegime) ? "FRANCHISE" : v.vatRegime,
      fiscalYearStartMonth: isMicroRegime(taxRegime) ? 1 : v.fiscalYearStartMonth,
    }));
  }

  function applyLookup(result: CompanyLookupResult) {
    setValues((v) => {
      const legalForm = result.legalForm;
      const keepTax = TAX_REGIMES_BY_LEGAL_FORM[legalForm].includes(v.taxRegime);
      const defaults = defaultRegimesFor(legalForm);
      return {
        ...v,
        name: result.name,
        tradeName: result.tradeName ?? "",
        siren: result.siren,
        siret: result.siret ?? "",
        vatNumber: result.vatNumber ?? "",
        nafCode: result.nafCode ?? "",
        legalForm,
        taxRegime: keepTax ? v.taxRegime : defaults.taxRegime,
        vatRegime: keepTax ? v.vatRegime : defaults.vatRegime,
        addressLine1: result.addressLine1 ?? "",
        postalCode: result.postalCode ?? "",
        city: result.city ?? "",
      };
    });
    setPrefilled(true);
    setErrors({});
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (mode === "create") {
        await api("/companies", { method: "POST", body: values });
        // La nouvelle entreprise devient l'entreprise active de la session.
        window.location.assign("/app/tableau-de-bord");
        return;
      }
      const { fiscalYearStartMonth: _ignored, ...payload } = values;
      void _ignored;
      await api(`/companies/${company!.id}`, { method: "PATCH", body: payload });
      toast.success("Informations de l'entreprise enregistrées.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        setErrors(error.fieldErrors);
        setFormError("Certaines informations sont invalides. Vérifiez les champs signalés.");
      } else {
        setFormError(errorMessage(error));
      }
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8">
      {mode === "create" ? <CompanySearch onSelect={applyLookup} /> : null}
      {prefilled ? (
        <Alert variant="success">
          <BadgeCheckIcon />
          <AlertDescription className="text-foreground">
            Informations pré-remplies à partir du répertoire Sirene. Vérifiez-les et complétez vos régimes avant de valider.
          </AlertDescription>
        </Alert>
      ) : null}
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2 text-foreground">{formError}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={readOnly || pending} className="grid gap-8">
        <section className="grid gap-5">
          <h3 className="text-base font-semibold">Identité</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="company-name" label="Raison sociale" error={errors.name} required>
              <Input value={values.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
            <Field id="company-trade-name" label="Nom commercial" error={errors.tradeName}>
              <Input value={values.tradeName} onChange={(e) => set("tradeName", e.target.value)} />
            </Field>
            <Field id="company-siren" label="SIREN" error={errors.siren} hint="9 chiffres">
              <Input value={values.siren} onChange={(e) => set("siren", e.target.value)} inputMode="numeric" />
            </Field>
            <Field id="company-siret" label="SIRET du siège" error={errors.siret} hint="14 chiffres">
              <Input value={values.siret} onChange={(e) => set("siret", e.target.value)} inputMode="numeric" />
            </Field>
            <Field id="company-vat-number" label="N° de TVA intracommunautaire" error={errors.vatNumber}>
              <Input value={values.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} placeholder="FR00123456789" />
            </Field>
            <Field id="company-naf" label="Code APE / NAF" error={errors.nafCode}>
              <Input value={values.nafCode} onChange={(e) => set("nafCode", e.target.value)} placeholder="62.01Z" />
            </Field>
          </div>
        </section>

        <section className="grid gap-5">
          <div>
            <h3 className="text-base font-semibold">Statut et régimes</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ces choix déterminent les fonctionnalités proposées. En cas de doute, vérifiez-les avec votre expert-comptable.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="company-legal-form" label="Forme juridique" error={errors.legalForm} required>
              <NativeSelect value={values.legalForm} onChange={(e) => changeLegalForm(e.target.value as LegalFormKey)}>
                {LEGAL_FORMS.map((key) => (
                  <option key={key} value={key}>{LEGAL_FORM_LABELS[key]}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="company-tax-regime" label="Régime fiscal" error={errors.taxRegime} required>
              <NativeSelect value={values.taxRegime} onChange={(e) => changeTaxRegime(e.target.value as TaxRegimeKey)}>
                {allowedTaxRegimes.map((key) => (
                  <option key={key} value={key}>{TAX_REGIME_LABELS[key]}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="company-vat-regime" label="Régime de TVA" error={errors.vatRegime} required>
              <NativeSelect value={values.vatRegime} onChange={(e) => set("vatRegime", e.target.value as VatRegimeKey)}>
                {VAT_REGIMES.map((key) => (
                  <option key={key} value={key}>{VAT_REGIME_LABELS[key]}</option>
                ))}
              </NativeSelect>
            </Field>
            {values.vatRegime !== "FRANCHISE" ? (
              <Field id="company-vat-exigibility" label="Exigibilité de la TVA" error={errors.vatExigibility} required>
                <NativeSelect value={values.vatExigibility} onChange={(e) => set("vatExigibility", e.target.value as VatExigibilityKey)}>
                  {VAT_EXIGIBILITIES.map((key) => (
                    <option key={key} value={key}>{VAT_EXIGIBILITY_LABELS[key]}</option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field
              id="company-fiscal-start"
              label="Début de l'exercice comptable"
              error={errors.fiscalYearStartMonth}
              hint={
                mode === "edit"
                  ? "Non modifiable après la création de l'entreprise."
                  : micro
                    ? "En micro-entreprise, l'exercice suit l'année civile."
                    : "Mois d'ouverture de votre exercice (janvier pour un exercice civil)."
              }
            >
              <NativeSelect
                value={values.fiscalYearStartMonth}
                onChange={(e) => set("fiscalYearStartMonth", Number(e.target.value))}
                disabled={mode === "edit" || micro}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>1er {monthName(month)}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </section>

        <section className="grid gap-5">
          <h3 className="text-base font-semibold">Coordonnées</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="company-address1" label="Adresse" error={errors.addressLine1} className="sm:col-span-2">
              <Input value={values.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} autoComplete="address-line1" />
            </Field>
            <Field id="company-address2" label="Complément d'adresse" error={errors.addressLine2} className="sm:col-span-2">
              <Input value={values.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} autoComplete="address-line2" />
            </Field>
            <Field id="company-postal-code" label="Code postal" error={errors.postalCode}>
              <Input value={values.postalCode} onChange={(e) => set("postalCode", e.target.value)} inputMode="numeric" autoComplete="postal-code" />
            </Field>
            <Field id="company-city" label="Ville" error={errors.city}>
              <Input value={values.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
            </Field>
            <Field id="company-email" label="E-mail de contact" error={errors.email}>
              <Input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field id="company-phone" label="Téléphone" error={errors.phone}>
              <Input type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </div>
        </section>
      </fieldset>

      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-6">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              Annuler
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {mode === "create" ? "Créer l'entreprise" : "Enregistrer les modifications"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
