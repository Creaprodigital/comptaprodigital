"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MailCheckIcon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { PLAN_KEYS, type PlanKey } from "@/lib/schemas/auth";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { AuthHeading, FormError, SubmitButton } from "@/components/auth/auth-shell";
import { PasswordChecklist, PasswordInput } from "@/components/auth/password-input";

const PLAN_LABELS: Record<PlanKey, string> = { STARTER: "Starter", PRO: "Pro", BUSINESS: "Business" };

export function RegisterForm() {
  const searchParams = useSearchParams();
  const requestedPlan = searchParams.get("plan")?.toUpperCase();
  const initialPlan: PlanKey = PLAN_KEYS.includes(requestedPlan as PlanKey) ? (requestedPlan as PlanKey) : "PRO";

  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api("/auth/register", {
        method: "POST",
        body: {
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          email,
          password: form.get("password"),
          plan: form.get("plan"),
          acceptTerms: form.get("acceptTerms") === "on",
        },
      });
      setSentTo(email);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success-foreground">
          <MailCheckIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Vérifiez votre boîte de réception</h1>
        <p className="mt-3 text-muted-foreground">
          Si l'adresse <strong className="text-foreground">{sentTo}</strong> peut être utilisée, un e-mail de confirmation
          vient de lui être envoyé. Cliquez sur le lien qu'il contient pour activer votre compte.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Rien reçu ? Vérifiez vos courriers indésirables, ou{" "}
          <Link href="/connexion" className="font-semibold text-primary underline-offset-4 hover:underline">
            connectez-vous
          </Link>{" "}
          pour demander un nouveau lien.
        </p>
      </div>
    );
  }

  return (
    <>
      <AuthHeading
        title="Créer votre compte"
        description={
          <>
            Essai gratuit, sans carte bancaire. Déjà inscrit ?{" "}
            <Link href="/connexion" className="font-semibold text-primary underline-offset-4 hover:underline">
              Se connecter
            </Link>
          </>
        }
      />
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={formError} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="register-first-name" label="Prénom" error={errors.firstName} required>
            <Input name="firstName" autoComplete="given-name" required />
          </Field>
          <Field id="register-last-name" label="Nom" error={errors.lastName} required>
            <Input name="lastName" autoComplete="family-name" required />
          </Field>
        </div>
        <Field id="register-email" label="Adresse e-mail professionnelle" error={errors.email} required>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="register-password" label="Mot de passe" error={errors.password} required>
          <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <PasswordChecklist value={password} />
        <Field id="register-plan" label="Formule à l'essai" error={errors.plan} hint="Vous pourrez en changer à tout moment.">
          <NativeSelect name="plan" defaultValue={initialPlan}>
            {PLAN_KEYS.map((key) => (
              <option key={key} value={key}>
                {PLAN_LABELS[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div>
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input type="checkbox" name="acceptTerms" className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]" />
            <span>
              J'accepte les{" "}
              <Link href="/cgu-cgv" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
                conditions générales
              </Link>{" "}
              et la{" "}
              <Link href="/confidentialite" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
                politique de confidentialité
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms ? <p className="mt-1.5 text-xs font-medium text-destructive-foreground">{errors.acceptTerms}</p> : null}
        </div>
        <SubmitButton pending={pending}>Créer mon compte</SubmitButton>
      </form>
    </>
  );
}
