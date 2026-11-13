import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Champ de formulaire : libellé, contrôle, aide et message d'erreur reliés pour l'accessibilité. */
function Field({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive-foreground" aria-hidden="true">*</span> : null}
      </Label>
      {React.cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
