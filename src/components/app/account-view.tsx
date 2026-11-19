"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyIcon, DownloadIcon, KeyRoundIcon, Loader2Icon, MonitorSmartphoneIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { toast } from "sonner";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordChecklist, PasswordInput } from "@/components/auth/password-input";
import { PageHeader } from "@/components/app/page-header";
import { AccountDeletionCard } from "@/components/app/account-deletion";
import type { DeletionCheck } from "@/server/modules/account/deletion";

export type AccountProfile = { firstName: string; lastName: string; email: string; phone: string | null; mfaEnabled: boolean };
export type AccountSession = { id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean };
export type AccountSubscription = { planName: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;

const SUBSCRIPTION_STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "accent" }> = {
  TRIALING: { label: "Période d'essai", variant: "accent" },
  ACTIVE: { label: "Actif", variant: "success" },
  PAST_DUE: { label: "Paiement en retard", variant: "warning" },
  UNPAID: { label: "Impayé", variant: "destructive" },
  INCOMPLETE: { label: "Incomplet", variant: "warning" },
  CANCELED: { label: "Résilié", variant: "destructive" },
  EXPIRED: { label: "Expiré", variant: "destructive" },
};

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Appareil inconnu";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Navigateur";
  const os = /Windows/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} sur ${os}` : browser;
}

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  async function submit(action: () => Promise<void>) {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return { pending, errors, formError, submit, setErrors };
}

function InlineError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{message}</p>
  ) : null;
}

function ProfileCard({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const { pending, errors, formError, submit } = useSubmit();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil</CardTitle>
        <CardDescription>Adresse de connexion : {profile.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post"
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void submit(async () => {
              await api("/me", { method: "PATCH", body: { firstName: form.get("firstName"), lastName: form.get("lastName"), phone: form.get("phone") ?? "" } });
              toast.success("Profil mis à jour.");
              router.refresh();
            });
          }}
        >
          <InlineError message={formError} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="profile-first-name" label="Prénom" error={errors.firstName} required>
              <Input name="firstName" defaultValue={profile.firstName} autoComplete="given-name" required />
            </Field>
            <Field id="profile-last-name" label="Nom" error={errors.lastName} required>
              <Input name="lastName" defaultValue={profile.lastName} autoComplete="family-name" required />
            </Field>
          </div>
          <Field id="profile-phone" label="Téléphone" error={errors.phone}>
            <Input name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" />
          </Field>
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Enregistrer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const { pending, errors, formError, submit, setErrors } = useSubmit();
  const [newPassword, setNewPassword] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mot de passe</CardTitle>
        <CardDescription>Le changement déconnecte vos autres appareils.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post"
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            if (form.get("newPassword") !== form.get("confirmation")) {
              setErrors({ confirmation: "Les deux mots de passe ne correspondent pas" });
              return;
            }
            void submit(async () => {
              await api("/me/password", { method: "POST", body: { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") } });
              toast.success("Mot de passe modifié.");
              formElement.reset();
              setNewPassword("");
            });
          }}
        >
          <InlineError message={formError} />
          <Field id="password-current" label="Mot de passe actuel" error={errors.currentPassword} required>
            <PasswordInput name="currentPassword" autoComplete="current-password" required />
          </Field>
          <Field id="password-new" label="Nouveau mot de passe" error={errors.newPassword} required>
            <PasswordInput name="newPassword" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </Field>
          <PasswordChecklist value={newPassword} />
          <Field id="password-confirmation" label="Confirmer le nouveau mot de passe" error={errors.confirmation} required>
            <PasswordInput name="confirmation" autoComplete="new-password" required />
          </Field>
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <KeyRoundIcon aria-hidden="true" />}
            Modifier le mot de passe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type MfaSetup = { secret: string; qrCodeDataUrl: string };

function MfaCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const { pending, errors, formError, submit } = useSubmit();
  // Le secret TOTP et les codes de secours ne doivent pas rester en mémoire d'une page masquée.
  useResetOnHide(() => {
    setSetup(null);
    setRecoveryCodes(null);
    setDisableOpen(false);
  });

  function start() {
    void submit(async () => setSetup(await api<MfaSetup>("/me/mfa/setup", { method: "POST" })));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Double authentification</CardTitle>
          {enabled ? (
            <Badge variant="success"><ShieldCheckIcon /> Activée</Badge>
          ) : (
            <Badge variant="warning"><ShieldOffIcon /> Désactivée</Badge>
          )}
        </div>
        <CardDescription>
          Un code à usage unique, généré par une application d'authentification, est demandé à chaque connexion en plus de
          votre mot de passe.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!setup && !recoveryCodes ? <InlineError message={formError} /> : null}
        {enabled ? (
          <Button variant="outline" className="justify-self-start" onClick={() => setDisableOpen(true)}>
            Désactiver la double authentification
          </Button>
        ) : (
          <Button className="justify-self-start" onClick={start} disabled={pending}>
            {pending && !setup ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <ShieldCheckIcon aria-hidden="true" />}
            Activer la double authentification
          </Button>
        )}
      </CardContent>

      {/* Activation : QR code puis vérification d'un premier code */}
      <Dialog open={setup !== null && recoveryCodes === null} onOpenChange={(open) => !open && setSetup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurer votre application</DialogTitle>
            <DialogDescription>
              Scannez ce QR code avec une application d'authentification (compatible TOTP), puis saisissez le code affiché.
            </DialogDescription>
          </DialogHeader>
          {setup ? (
            <form method="post"
              noValidate
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                const code = new FormData(event.currentTarget).get("code");
                void submit(async () => {
                  const result = await api<{ recoveryCodes: string[] }>("/me/mfa/enable", { method: "POST", body: { code } });
                  setRecoveryCodes(result.recoveryCodes);
                });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- image générée côté serveur, encodée en data URL */}
              <img src={setup.qrCodeDataUrl} alt="QR code de configuration de la double authentification" width={220} height={220} className="mx-auto rounded-xl border bg-white p-2" />
              <p className="text-center text-xs text-muted-foreground">
                Saisie manuelle : <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{setup.secret}</code>
              </p>
              <InlineError message={formError} />
              <Field id="mfa-enable-code" label="Code à 6 chiffres" error={errors.code} required>
                <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-mono text-lg tracking-[0.3em]" required />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">Annuler</Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                  Activer
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Codes de secours : affichés une seule fois */}
      <Dialog
        open={recoveryCodes !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecoveryCodes(null);
            setSetup(null);
            router.refresh();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conservez vos codes de secours</DialogTitle>
            <DialogDescription>
              Chaque code permet une connexion si vous perdez votre téléphone. Ils ne seront plus jamais affichés : notez-les
              en lieu sûr.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-muted p-4 font-mono text-sm">
            {recoveryCodes?.map((code) => <li key={code}>{code}</li>)}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText((recoveryCodes ?? []).join("\n"));
                toast.success("Codes copiés dans le presse-papiers.");
              }}
            >
              <CopyIcon /> Copier
            </Button>
            <DialogClose asChild>
              <Button>J'ai noté mes codes</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Désactivation : confirmation par mot de passe */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Désactiver la double authentification ?</DialogTitle>
            <DialogDescription>Votre compte ne sera plus protégé que par votre mot de passe.</DialogDescription>
          </DialogHeader>
          <form method="post"
            noValidate
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const password = new FormData(event.currentTarget).get("password");
              void submit(async () => {
                await api("/me/mfa/disable", { method: "POST", body: { password } });
                toast.success("Double authentification désactivée.");
                setDisableOpen(false);
                router.refresh();
              });
            }}
          >
            <InlineError message={formError} />
            <Field id="mfa-disable-password" label="Mot de passe" error={errors.password} required>
              <PasswordInput name="password" autoComplete="current-password" required />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>Désactiver</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SessionsCard({ sessions }: { sessions: AccountSession[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await api(`/me/sessions/${id}`, { method: "DELETE" });
      toast.success("Session déconnectée.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions actives</CardTitle>
        <CardDescription>Appareils actuellement connectés à votre compte.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                <MonitorSmartphoneIcon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {describeDevice(session.userAgent)}
                  {session.current ? <Badge variant="success">Cette session</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? "Adresse inconnue"} · dernière activité le {formatDateTime(session.lastSeenAt)}
                </p>
              </div>
              {!session.current ? (
                <Button variant="outline" size="sm" disabled={busyId === session.id} onClick={() => revoke(session.id)}>
                  Déconnecter
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AccountView({
  profile,
  sessions,
  subscription,
  deletion,
}: {
  profile: AccountProfile;
  sessions: AccountSession[];
  subscription: AccountSubscription;
  deletion: DeletionCheck;
}) {
  const status = subscription ? SUBSCRIPTION_STATUS[subscription.status] : null;
  return (
    <>
      <PageHeader title="Compte et sécurité" description="Vos informations personnelles, votre mot de passe et la protection de votre compte." />
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCard profile={profile} />
        <PasswordCard />
        <MfaCard enabled={profile.mfaEnabled} />
        <SessionsCard sessions={sessions} />

        <Card>
          <CardHeader>
            <CardTitle>Abonnement</CardTitle>
            <CardDescription>Formule associée à votre compte.</CardDescription>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Formule</dt>
                  <dd className="font-semibold">{subscription.planName}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Statut</dt>
                  <dd>{status ? <Badge variant={status.variant}>{status.label}</Badge> : subscription.status}</dd>
                </div>
                {subscription.status === "TRIALING" && subscription.trialEndsAt ? (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Fin de l'essai</dt>
                    <dd className="font-medium">{formatDate(subscription.trialEndsAt.slice(0, 10))}</dd>
                  </div>
                ) : null}
                {subscription.currentPeriodEnd ? (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Prochaine échéance</dt>
                    <dd className="font-medium">{formatDate(subscription.currentPeriodEnd.slice(0, 10))}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun abonnement n'est associé à ce compte.</p>
            )}
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/app/abonnement">Gérer l'abonnement</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vos données personnelles</CardTitle>
            <CardDescription>
              Téléchargez une copie des données personnelles liées à votre compte (droit d'accès et de portabilité, RGPD).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href="/api/v1/me/export" download>
                <DownloadIcon /> Exporter mes données (JSON)
              </a>
            </Button>
          </CardContent>
        </Card>
        <AccountDeletionCard check={deletion} mfaEnabled={profile.mfaEnabled} />
      </div>
    </>
  );
}
