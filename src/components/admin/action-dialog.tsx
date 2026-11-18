"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type ActionField = {
  name: string;
  label: string;
  type: "textarea" | "number" | "select" | "text";
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
};

/**
 * Action d'administration confirmée dans une boîte de dialogue : champs déclaratifs
 * (motif, durée…), valeurs fixes fusionnées dans le corps de la requête, puis
 * rafraîchissement de la page. Utilisable depuis un composant serveur.
 */
export function ActionDialog({
  trigger,
  variant = "outline",
  title,
  description,
  endpoint,
  method = "POST",
  fixed = {},
  fields = [],
  confirmLabel,
  destructive = false,
  success,
  redirectTo,
}: {
  trigger: string;
  variant?: "outline" | "default" | "destructive" | "secondary" | "ghost";
  title: string;
  description?: string;
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  fixed?: Record<string, unknown>;
  fields?: ActionField[];
  confirmLabel?: string;
  destructive?: boolean;
  success: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api(endpoint, { method, body: method === "DELETE" && fields.length === 0 ? undefined : { ...values, ...fixed } });
      toast.success(success);
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors({}); }}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {fields.map((f) => (
            <Field key={f.name} id={`action-${f.name}`} label={f.label} hint={f.hint} error={errors[f.name]} required={f.required}>
              {f.type === "textarea" ? (
                <Textarea name={f.name} rows={3} defaultValue={f.defaultValue} required={f.required} maxLength={500} />
              ) : f.type === "select" ? (
                <NativeSelect name={f.name} defaultValue={f.defaultValue}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input name={f.name} type={f.type} min={f.min} max={f.max} defaultValue={f.defaultValue} required={f.required} />
              )}
            </Field>
          ))}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {confirmLabel ?? trigger}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
