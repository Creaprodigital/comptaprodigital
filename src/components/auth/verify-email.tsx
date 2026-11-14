"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError, SubmitButton } from "@/components/auth/auth-shell";

type State = { status: "verifying" } | { status: "success" } | { status: "error"; message: string };

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>(token ? { status: "verifying" } : { status: "error", message: "Lien de confirmation incomplet." });
  const [resendState, setResendState] = useState<{ pending: boolean; done: boolean; error: string | null }>({ pending: false, done: false, error: null });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState({ status: "success" }))
      .catch((error) => setState({ status: "error", message: errorMessage(error) }));
  }, [token]);

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setResendState({ pending: true, done: false, error: null });
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email } });
      setResendState({ pending: false, done: true, error: null });
    } catch (error) {
      setResendState({ pending: false, done: false, error: errorMessage(error) });
    }
  }

  if (state.status === "verifying") {
    return (
      <div className="text-center" role="status">
        <Loader2Icon className="mx-auto size-10 animate-spin text-primary" aria-hidden="true" />
        <h1 className="mt-6 text-2xl font-bold">Confirmation en cours…</h1>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success-foreground">
          <CheckCircle2Icon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Adresse e-mail confirmée</h1>
        <p className="mt-3 text-muted-foreground">Votre compte est activé. Connectez-vous pour ajouter votre entreprise.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link href="/connexion">Se connecter</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning-foreground">
          <TriangleAlertIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Lien invalide ou expiré</h1>
        <p className="mt-3 text-muted-foreground">{state.message}</p>
      </div>
      <form method="post" onSubmit={resend} noValidate className="mt-8 grid gap-4">
        <FormError message={resendState.error} />
        {resendState.done ? (
          <p className="rounded-xl bg-success-soft px-4 py-3 text-sm text-foreground" role="status">
            Si un compte en attente de confirmation existe pour cette adresse, un nouveau lien vient d'être envoyé.
          </p>
        ) : (
          <>
            <Field id="resend-email" label="Recevoir un nouveau lien" required>
              <Input name="email" type="email" autoComplete="email" placeholder="vous@entreprise.fr" required />
            </Field>
            <SubmitButton pending={resendState.pending}>Renvoyer le lien de confirmation</SubmitButton>
          </>
        )}
      </form>
    </div>
  );
}
