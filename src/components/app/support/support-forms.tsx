"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import type { TicketView } from "@/server/modules/support/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";

export function NewTicketForm({ companies, defaultCompanyId }: { companies: Array<{ id: string; name: string }>; defaultCompanyId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const ticket = await api<TicketView>("/me/support", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast.success(`Demande ${ticket.reference} envoyée.`);
      setPending(false);
      router.push(`/app/support/${ticket.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field id="ticket-subject" label="Objet" error={errors.subject} required>
        <Input name="subject" required maxLength={191} />
      </Field>
      {companies.length > 0 ? (
        <Field id="ticket-company" label="Entreprise concernée" error={errors.companyId}>
          <NativeSelect name="companyId" defaultValue={defaultCompanyId ?? ""}>
            <option value="">Aucune en particulier</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
      ) : null}
      <Field id="ticket-message" label="Votre message" error={errors.message} required hint="Ne communiquez jamais de mot de passe ni de coordonnées bancaires complètes.">
        <Textarea name="message" required rows={6} maxLength={10000} />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon />} Envoyer la demande</Button>
      </div>
    </form>
  );
}

export function ReplyForm({ endpoint, staff = false, statuses }: { endpoint: string; staff?: boolean; statuses?: Array<{ value: string; label: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState(statuses?.[0]?.value ?? "");
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api(endpoint, { method: "POST", body: staff ? { body, status } : { body } });
      toast.success(staff ? "Réponse envoyée au demandeur." : "Message envoyé.");
      setBody("");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} required aria-label="Votre réponse" placeholder="Votre réponse…" />
      <div className="flex flex-wrap items-center gap-2">
        {statuses ? (
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut après la réponse" className="h-9 w-64">
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </NativeSelect>
        ) : null}
        <Button type="submit" disabled={pending || body.trim().length < 2}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon />} Envoyer</Button>
      </div>
    </form>
  );
}
