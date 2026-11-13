"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/auth/auth-shell";

type Preview = { companyName: string; roleName: string; invitedBy: string; email: string; expiresAt: string };

export function InvitationCard() {
  const { token } = useParams<{ token: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<Preview>(`/invitations/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((error) => setLoadError(errorMessage(error)));
  }, [token]);

  async function accept() {
    setPending(true);
    setActionError(null);
    try {
      await api(`/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
      window.location.assign("/app/tableau-de-bord");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setNeedsLogin(true);
      else setActionError(errorMessage(error));
      setPending(false);
    }
  }

  if (loadError) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning-foreground">
          <TriangleAlertIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-bold">Invitation indisponible</h1>
        <p className="mt-3 text-muted-foreground">{loadError}</p>
        <Button asChild variant="outline" size="lg" className="mt-8 w-full">
          <Link href="/">Retour à l'accueil</Link>
        </Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="text-center" role="status">
        <Loader2Icon className="mx-auto size-10 animate-spin text-primary" aria-hidden="true" />
        <p className="mt-4 text-muted-foreground">Chargement de l'invitation…</p>
      </div>
    );
  }

  const next = encodeURIComponent(`/invitation/${token}`);

  return (
    <div>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
        <Building2Icon className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-2xl font-bold">Rejoindre {preview.companyName}</h1>
      <p className="mt-3 text-muted-foreground">
        {preview.invitedBy} vous invite à rejoindre cette entreprise avec le rôle{" "}
        <strong className="text-foreground">{preview.roleName}</strong>.
      </p>
      <dl className="mt-6 grid gap-2 rounded-xl border bg-card p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Invitation adressée à</dt>
          <dd className="font-medium">{preview.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Valable jusqu'au</dt>
          <dd className="font-medium">{formatDate(preview.expiresAt.slice(0, 10))}</dd>
        </div>
      </dl>

      <div className="mt-6 grid gap-3">
        <FormError message={actionError} />
        {needsLogin ? (
          <>
            <p className="rounded-xl bg-accent px-4 py-3 text-sm">
              Connectez-vous ou créez un compte avec l'adresse <strong>{preview.email}</strong> pour accepter l'invitation.
            </p>
            <Button asChild size="lg">
              <Link href={`/connexion?next=${next}`}>Se connecter</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/inscription">Créer un compte</Link>
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={accept} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Accepter l'invitation
          </Button>
        )}
      </div>
    </div>
  );
}
