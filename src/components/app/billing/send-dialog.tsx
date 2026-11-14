"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

export type SendDefaults = { to: string; subject: string; message: string };

/** Envoi d'un devis ou d'une facture par e-mail, PDF joint. Le message est modifiable avant l'envoi. */
export function SendDialog({ endpoint, defaults, open, onOpenChange, documentLabel }: { endpoint: string; defaults: SendDefaults; open: boolean; onOpenChange: (open: boolean) => void; documentLabel: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(endpoint, { method: "POST", body: { to: form.get("to"), subject: form.get("subject"), message: form.get("message"), copyToSelf: form.get("copyToSelf") === "on" } });
      toast.success(`${documentLabel} envoyé${documentLabel === "Facture" ? "e" : ""} par e-mail.`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Envoyer par e-mail</DialogTitle>
          <DialogDescription>Le document est joint au format PDF. Les réponses vous parviennent directement.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <Field id="send-to" label="Destinataire" error={errors.to} required>
            <Input name="to" type="email" defaultValue={defaults.to} required />
          </Field>
          <Field id="send-subject" label="Objet" error={errors.subject} required>
            <Input name="subject" defaultValue={defaults.subject} required />
          </Field>
          <Field id="send-message" label="Message" error={errors.message} required>
            <Textarea name="message" rows={9} defaultValue={defaults.message} required />
          </Field>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="copyToSelf" className="size-4 accent-[var(--primary)]" />
            Recevoir une copie de cet e-mail
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
              Envoyer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
