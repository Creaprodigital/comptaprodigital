"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { CustomerView } from "@/server/modules/customers/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";

/** Création ou modification d'un client. `customer` absent : création. */
export function CustomerDialog({
  companyId,
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  companyId: string;
  customer?: CustomerView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: CustomerView) => void;
}) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = customer
        ? await api<CustomerView>(`/companies/${companyId}/customers/${customer.id}`, { method: "PATCH", body })
        : await api<CustomerView>(`/companies/${companyId}/customers`, { method: "POST", body });
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer ? "Modifier le client" : "Nouveau client"}</DialogTitle>
          <DialogDescription>Ces informations figurent sur vos devis et factures.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={customer?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="customer-name" label="Nom ou raison sociale" error={errors.name} required className="sm:col-span-2">
              <Input name="name" defaultValue={customer?.name ?? ""} required autoFocus />
            </Field>
            <Field id="customer-type" label="Type de client" error={errors.type} hint="Un professionnel est redevable de l'indemnité de recouvrement.">
              <NativeSelect name="type" defaultValue={customer?.type ?? "COMPANY"}>
                <option value="COMPANY">Professionnel</option>
                <option value="INDIVIDUAL">Particulier</option>
              </NativeSelect>
            </Field>
            <Field id="customer-contact" label="Interlocuteur" error={errors.contactName}>
              <Input name="contactName" defaultValue={customer?.contactName ?? ""} />
            </Field>
            <Field id="customer-email" label="Adresse e-mail" error={errors.email} hint="Utilisée pour l'envoi des documents et les relances.">
              <Input name="email" type="email" defaultValue={customer?.email ?? ""} />
            </Field>
            <Field id="customer-phone" label="Téléphone" error={errors.phone}>
              <Input name="phone" type="tel" defaultValue={customer?.phone ?? ""} />
            </Field>
            <Field id="customer-siren" label="SIREN" error={errors.siren} hint="Mention obligatoire sur les factures entre professionnels.">
              <Input name="siren" inputMode="numeric" defaultValue={customer?.siren ?? ""} />
            </Field>
            <Field id="customer-vat" label="N° de TVA intracommunautaire" error={errors.vatNumber}>
              <Input name="vatNumber" defaultValue={customer?.vatNumber ?? ""} />
            </Field>
            <Field id="customer-address1" label="Adresse" error={errors.addressLine1} className="sm:col-span-2">
              <Input name="addressLine1" defaultValue={customer?.addressLine1 ?? ""} />
            </Field>
            <Field id="customer-postal" label="Code postal" error={errors.postalCode}>
              <Input name="postalCode" defaultValue={customer?.postalCode ?? ""} />
            </Field>
            <Field id="customer-city" label="Ville" error={errors.city}>
              <Input name="city" defaultValue={customer?.city ?? ""} />
            </Field>
            <Field id="customer-country" label="Pays (code)" error={errors.country}>
              <Input name="country" maxLength={2} defaultValue={customer?.country ?? "FR"} />
            </Field>
            <Field id="customer-term" label="Délai de paiement (jours)" error={errors.paymentTermDays} hint="Vide : délai par défaut de l'entreprise.">
              <Input name="paymentTermDays" inputMode="numeric" defaultValue={customer?.paymentTermDays ?? ""} />
            </Field>
            <Field id="customer-notes" label="Notes internes" error={errors.notes} className="sm:col-span-2">
              <Textarea name="notes" rows={2} className="min-h-16" defaultValue={customer?.notes ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {customer ? "Enregistrer" : "Créer le client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
