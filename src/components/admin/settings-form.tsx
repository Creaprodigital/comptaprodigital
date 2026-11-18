"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SaveIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";

export type SettingRow = { key: string; group: string; label: string; description: string; value: unknown; isDefault: boolean; kind: string; options?: string[] };

/** Un paramètre global, enregistré individuellement (chaque modification est auditée). */
export function SettingField({ setting }: { setting: SettingRow }) {
  const router = useRouter();
  const [value, setValue] = useState<unknown>(setting.value);
  const [pending, setPending] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(setting.value);
  async function save() {
    setPending(true);
    try {
      await api("/admin/settings", { method: "PUT", body: { key: setting.key, value: setting.kind === "int" ? Number(value) : value } });
      toast.success(`« ${setting.label} » enregistré.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  const id = `setting-${setting.key.replace(/\./g, "-")}`;
  return (
    <div className="grid gap-2 py-4 md:grid-cols-[1fr_20rem_auto] md:items-center">
      <div>
        <label htmlFor={id} className="text-sm font-medium">{setting.label}</label>
        <p className="text-xs text-muted-foreground">{setting.description}{setting.isDefault ? " (valeur par défaut)" : ""}</p>
      </div>
      {setting.kind === "boolean" ? (
        <NativeSelect id={id} value={value ? "true" : "false"} onChange={(e) => setValue(e.target.value === "true")}>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </NativeSelect>
      ) : setting.kind === "enum" ? (
        <NativeSelect id={id} value={String(value)} onChange={(e) => setValue(e.target.value)}>
          {setting.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      ) : setting.kind === "text" ? (
        <Textarea id={id} rows={2} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <Input id={id} type={setting.kind === "int" ? "number" : "text"} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} />
      )}
      <Button type="button" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || pending} onClick={save}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SaveIcon />} Enregistrer
      </Button>
    </div>
  );
}

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [pending, setPending] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api("/admin/mail/test", { method: "POST", body: { to } });
      toast.success(`E-mail de test envoyé à ${to}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={send} className="flex flex-wrap gap-2">
      <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-72" aria-label="Destinataire" required />
      <Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon />} Envoyer un e-mail de test</Button>
    </form>
  );
}
