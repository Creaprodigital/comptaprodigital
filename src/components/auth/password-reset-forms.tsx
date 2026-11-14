"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CheckCircle2Icon, MailCheckIcon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthHeading, FormError, SubmitButton } from "@/components/auth/auth-shell";
import { PasswordChecklist, PasswordInput } from "@/components/auth/password-input";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email: new FormData(event.currentTarget).get("email") } });
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success-foreground">
          <MailCheckIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Consultez votre messagerie</h1>
        <p className="mt-3 text-muted-foreground">
          Si un compte existe pour cette adresse, un lien de réinitialisation valable 60 minutes vient d'être envoyé.
        </p>
        <Button asChild variant="outline" size="lg" className="mt-8 w-full">
          <Link href="/connexion">Retour à la connexion</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Mot de passe oublié" description="Indiquez l'adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe." />
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={formError} />
        <Field id="forgot-email" label="Adresse e-mail" error={errors.email} required>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton pending={pending}>Envoyer le lien</SubmitButton>
        <Button asChild variant="ghost">
          <Link href="/connexion">Retour à la connexion</Link>
        </Button>
      </form>
    </>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(token ? null : "Lien de réinitialisation incomplet.");
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirmation")) {
      setErrors({ confirmation: "Les deux mots de passe ne correspondent pas" });
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password: form.get("password") } });
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success-foreground">
          <CheckCircle2Icon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Mot de passe modifié</h1>
        <p className="mt-3 text-muted-foreground">Toutes vos sessions ont été déconnectées. Vous pouvez vous reconnecter avec votre nouveau mot de passe.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link href="/connexion">Se connecter</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Nouveau mot de passe" description="Choisissez un mot de passe que vous n'utilisez sur aucun autre service." />
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={formError ?? errors.token ?? null} />
        <Field id="reset-password" label="Nouveau mot de passe" error={errors.password} required>
          <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <PasswordChecklist value={password} />
        <Field id="reset-confirmation" label="Confirmer le mot de passe" error={errors.confirmation} required>
          <PasswordInput name="confirmation" autoComplete="new-password" required />
        </Field>
        <SubmitButton pending={pending || !token}>Enregistrer le mot de passe</SubmitButton>
        <Button asChild variant="ghost">
          <Link href="/mot-de-passe-oublie">Demander un nouveau lien</Link>
        </Button>
      </form>
    </>
  );
}
