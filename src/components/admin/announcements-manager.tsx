"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { AnnouncementView } from "@/server/modules/admin/announcements";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const LEVELS = { INFO: "Information", WARNING: "Avertissement", CRITICAL: "Critique" } as const;

/** Date ISO → valeur d'un champ datetime-local (heure locale du navigateur). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AnnouncementsManager({ announcements }: { announcements: AnnouncementView[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AnnouncementView | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const current = editing && editing !== "new" ? editing : null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = (name: string) => {
      const v = String(form.get(name) ?? "");
      return v ? new Date(v).toISOString() : null;
    };
    setPending(true);
    setErrors({});
    try {
      await api(current ? `/admin/announcements/${current.id}` : "/admin/announcements", {
        method: current ? "PUT" : "POST",
        body: { title: form.get("title"), body: form.get("body"), level: form.get("level"), startsAt: date("startsAt"), endsAt: date("endsAt"), isActive: form.get("isActive") === "on" },
      });
      toast.success("Annonce enregistrée.");
      setEditing(null);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function remove(a: AnnouncementView) {
    if (!window.confirm(`Supprimer l'annonce « ${a.title} » ?`)) return;
    try {
      await api(`/admin/announcements/${a.id}`, { method: "DELETE" });
      toast.success("Annonce supprimée.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <div className="mb-4">
        <Button type="button" onClick={() => { setErrors({}); setEditing("new"); }}><PlusIcon /> Nouvelle annonce</Button>
      </div>
      {announcements.length === 0 ? (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">Aucune annonce.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {announcements.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {a.title}
                  <Badge variant={a.level === "CRITICAL" ? "destructive" : a.level === "WARNING" ? "warning" : "accent"}>{LEVELS[a.level]}</Badge>
                  {a.live ? <Badge variant="success">En ligne</Badge> : <Badge variant="secondary">{a.isActive ? "Programmée ou terminée" : "Désactivée"}</Badge>}
                </p>
                <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{a.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">Du {formatDateTime(a.startsAt)}{a.endsAt ? ` au ${formatDateTime(a.endsAt)}` : ", sans date de fin"}</p>
              </div>
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Modifier « ${a.title} »`} onClick={() => { setErrors({}); setEditing(a); }}><PencilIcon /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer « ${a.title} »`} onClick={() => remove(a)}><Trash2Icon /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current ? "Modifier l'annonce" : "Nouvelle annonce"}</DialogTitle>
            <DialogDescription>Affichée en bandeau dans l'espace client de tous les utilisateurs pendant la période indiquée.</DialogDescription>
          </DialogHeader>
          <form key={current?.id ?? "new"} onSubmit={save} noValidate className="grid gap-4">
            <Field id="ann-title" label="Titre" error={errors.title} required><Input name="title" defaultValue={current?.title} maxLength={160} required /></Field>
            <Field id="ann-body" label="Message" error={errors.body} required><Textarea name="body" rows={4} defaultValue={current?.body} maxLength={2000} required /></Field>
            <Field id="ann-level" label="Niveau" error={errors.level}>
              <NativeSelect name="level" defaultValue={current?.level ?? "INFO"}>{Object.entries(LEVELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ann-start" label="Début" error={errors.startsAt} hint="Vide = immédiatement"><Input name="startsAt" type="datetime-local" defaultValue={toLocalInput(current?.startsAt ?? null)} /></Field>
              <Field id="ann-end" label="Fin" error={errors.endsAt} hint="Vide = sans fin"><Input name="endsAt" type="datetime-local" defaultValue={toLocalInput(current?.endsAt ?? null)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={current?.isActive ?? true} className="size-4" /> Active</label>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
              <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
