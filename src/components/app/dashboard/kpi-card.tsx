import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

const tones = {
  default: "bg-accent text-primary",
  success: "bg-success-soft text-success-foreground",
  warning: "bg-warning-soft text-warning-foreground",
  danger: "bg-destructive-soft text-destructive-foreground",
} as const;

/** Tuile d'indicateur : libellé, valeur, précision. La valeur reste en couleur de texte ; seule l'icône porte le ton. */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof tones;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("p-5", emphasis && "border-transparent bg-navy text-white dark:border-primary/40")}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm font-medium", emphasis ? "text-slate-300" : "text-muted-foreground")}>{label}</p>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", emphasis ? "bg-white/10 text-emerald-400" : tones[tone])}>
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
      </div>
      <p className="tabular mt-3 font-display text-[26px] leading-none font-bold tracking-tight">{value}</p>
      {hint ? <p className={cn("mt-2 text-xs leading-relaxed", emphasis ? "text-slate-300" : "text-muted-foreground")}>{hint}</p> : null}
    </Card>
  );
}
