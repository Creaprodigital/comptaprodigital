"use client";

import { useState } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

export function ContactForm() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await api<{ reference: string }>("/contact", {
        method: "POST",
        body: {
          name: form.get("name"),
          email: form.get("email"),
          subject: form.get("subject"),
          message: form.get("message"),
          consent: form.get("consent") === "on",
          website: form.get("website") ?? "",
        },
      });
      setReference(result.reference);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (reference) {
    return (
      <Alert variant="success">
        <CheckCircle2Icon />
        <AlertTitle>Message envoyé</AlertTitle>
        <AlertDescription>
          Merci, votre demande est enregistrée sous la référence <strong className="text-foreground">{reference}</strong>.
          Un accusé de réception vous a été adressé par e-mail.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2">{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contact-name" label="Nom" error={errors.name} required>
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field id="contact-email" label="Adresse e-mail" error={errors.email} required>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
      </div>
      <Field id="contact-subject" label="Objet" error={errors.subject} required>
        <Input name="subject" required />
      </Field>
      <Field id="contact-message" label="Message" error={errors.message} required>
        <Textarea name="message" rows={6} required />
      </Field>
      {/* Champ piège anti-robots, invisible et ignoré des lecteurs d'écran. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Site web
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input type="checkbox" name="consent" className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]" />
          <span>
            J'accepte que les informations saisies soient utilisées pour traiter ma demande, conformément à la{" "}
            <a href="/confidentialite" className="font-medium text-primary underline-offset-4 hover:underline">
              politique de confidentialité
            </a>
            .
          </span>
        </label>
        {errors.consent ? <p className="mt-1.5 text-xs font-medium text-destructive-foreground">{errors.consent}</p> : null}
      </div>
      <Button type="submit" size="lg" disabled={pending} className="justify-self-start">
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        Envoyer le message
      </Button>
    </form>
  );
}
