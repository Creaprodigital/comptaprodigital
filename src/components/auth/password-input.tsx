"use client";

import { useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function PasswordInput({ className, ...props }: React.ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

const RULES = [
  { label: "12 caractères minimum", test: (v: string) => v.length >= 12 },
  { label: "Une minuscule et une majuscule", test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { label: "Un chiffre", test: (v: string) => /\d/.test(v) },
  { label: "Un caractère spécial", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

/** Rappel visuel de la politique de mot de passe (la validation réelle est faite côté serveur). */
export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Exigences du mot de passe">
      {RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <li key={rule.label} className={cn("flex items-center gap-1.5", ok ? "text-success-foreground" : "text-muted-foreground")}>
            {ok ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <XIcon className="size-3.5 opacity-50" aria-hidden="true" />}
            {rule.label}
            <span className="sr-only">{ok ? " : respecté" : " : non respecté"}</span>
          </li>
        );
      })}
    </ul>
  );
}
