"use client";

import { useState } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { DeletionCheck } from "@/server/modules/account/deletion";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Suppression du compte par son titulaire, avec ses conséquences exposées avant confirmation. */
export function AccountDeletionCard({ check, mfaEnabled }: { check: DeletionCheck; mfaEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await api("/me/deletion", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      window.location.assign("/?compte=supprime");
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <Card className="border-destructive/30 xl:col-span-2">
      <CardHeader>
        <CardTitle>Supprimer mon compte</CardTitle>
        <CardDescription>
          Vos données personnelles sont effacées ou anonymisées et votre abonnement est résilié immédiatement. Pensez à exporter vos données et vos écritures (FEC) au préalable.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {check.companiesToArchive.length > 0 ? (
          <p>
            Entreprise(s) archivée(s) avec le compte : <strong>{check.companiesToArchive.map((c) => c.name).join(", ")}</strong>. Leurs pièces et écritures comptables restent conservées dix ans (obligation légale), sans être accessibles.
          </p>
        ) : null}
        {check.blockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-destructive">{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        ) : null}
        <div>
          <Button type="button" variant="destructive" disabled={!check.allowed} onClick={() => setOpen(true)}>
            <Trash2Icon /> Supprimer mon compte
          </Button>
        </div>
      </CardContent>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer définitivement votre compte ?</DialogTitle>
            <DialogDescription>Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <Field id="del-password" label="Mot de passe" error={errors.password} required>
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            {mfaEnabled ? (
              <Field id="del-code" label="Code de double authentification" error={errors.code} required>
                <Input name="code" inputMode="numeric" autoComplete="one-time-code" required />
              </Field>
            ) : null}
            <Field id="del-confirm" label="Saisissez SUPPRIMER pour confirmer" error={errors.confirmation} required>
              <Input name="confirmation" autoComplete="off" required />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Supprimer définitivement
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
