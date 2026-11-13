"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthHeading, FormError, SubmitButton, safeNextPath } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";

type Step = "credentials" | "mfa";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  function enterApp() {
    // Navigation complète : le serveur relit la session fraîchement créée.
    window.location.assign(next);
  }

  async function submitCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
    setFormError(null);
    setUnverified(false);
    try {
      const result = await api<{ status: "authenticated" | "mfa_required" }>("/auth/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") },
      });
      if (result.status === "mfa_required") {
        setStep("mfa");
        setPending(false);
      } else {
        enterApp();
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      else setFormError(errorMessage(error));
      setPending(false);
    }
  }

  async function submitMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFormError(null);
    try {
      await api("/auth/mfa", { method: "POST", body: { code: form.get("code") } });
      enterApp();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED") {
        setStep("credentials");
        setFormError("La vérification a expiré. Veuillez vous reconnecter.");
      } else {
        setFormError(errorMessage(error));
      }
      setPending(false);
    }
  }

  async function resendVerification() {
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email } });
      setResent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  if (step === "mfa") {
    return (
      <>
        <AuthHeading
          title="Vérification en deux étapes"
          description="Saisissez le code à 6 chiffres affiché par votre application d'authentification, ou l'un de vos codes de secours."
        />
        <form onSubmit={submitMfa} noValidate className="grid gap-5">
          <FormError message={formError} />
          <Field id="mfa-code" label="Code de vérification" required>
            <Input
              name="code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              maxLength={20}
              className="h-12 text-center font-mono text-lg tracking-[0.3em]"
              required
            />
          </Field>
          <SubmitButton pending={pending}>Valider</SubmitButton>
          <Button type="button" variant="ghost" onClick={() => { setStep("credentials"); setFormError(null); }}>
            Revenir à la connexion
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Connexion"
        description={
          <>
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-semibold text-primary underline-offset-4 hover:underline">
              Essayer gratuitement
            </Link>
          </>
        }
      />
      <form onSubmit={submitCredentials} noValidate className="grid gap-5">
        <FormError message={formError} />
        {unverified ? (
          <Alert variant="warning">
            <ShieldCheckIcon />
            <AlertTitle>Adresse e-mail à confirmer</AlertTitle>
            <AlertDescription>
              {resent ? (
                "Un nouveau lien de confirmation vient de vous être envoyé."
              ) : (
                <>
                  Cliquez sur le lien reçu par e-mail pour activer votre compte.{" "}
                  <button type="button" onClick={resendVerification} className="font-semibold text-primary underline-offset-4 hover:underline">
                    Renvoyer le lien
                  </button>
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <Field id="login-email" label="Adresse e-mail" error={errors.email} required>
          <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="login-password" label="Mot de passe" error={errors.password} required>
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
        <div className="-mt-2 text-right">
          <Link href="/mot-de-passe-oublie" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        <SubmitButton pending={pending}>Se connecter</SubmitButton>
      </form>
    </>
  );
}
