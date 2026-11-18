"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangleIcon, InfoIcon, LockIcon, MegaphoneIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AppBanner =
  | { kind: "announcement"; id: string; level: "INFO" | "WARNING" | "CRITICAL"; title: string; body: string }
  | { kind: "billing"; id: string; level: "INFO" | "WARNING" | "CRITICAL"; title: string; body: string; action?: { label: string; href: string } };

const STYLES = {
  INFO: "border-primary/20 bg-accent [&_svg]:text-primary",
  WARNING: "border-warning/30 bg-warning-soft [&_svg]:text-warning-foreground",
  CRITICAL: "border-destructive/30 bg-destructive-soft [&_svg]:text-destructive-foreground",
} as const;

const DISMISSED_KEY = "cpd.dismissed-announcements";

/** Bandeaux de l'espace client : annonces de la plateforme (masquables) et situation de l'abonnement. */
export function AppBanners({ banners }: { banners: AppBanner[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]");
      if (Array.isArray(stored)) queueMicrotask(() => setDismissed(stored.filter((v): v is string => typeof v === "string")));
    } catch {
      // Stockage indisponible : les annonces restent affichées.
    }
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Sans stockage, le masquage vaut pour la page en cours.
    }
  }

  const visible = banners.filter((b) => b.kind === "billing" || b.level === "CRITICAL" || !dismissed.includes(b.id));
  if (visible.length === 0) return null;
  return (
    <div className="mb-6 grid gap-2">
      {visible.map((banner) => {
        const Icon = banner.kind === "announcement" ? (banner.level === "INFO" ? MegaphoneIcon : AlertTriangleIcon) : banner.level === "CRITICAL" ? LockIcon : banner.level === "WARNING" ? AlertTriangleIcon : InfoIcon;
        return (
          <div key={banner.id} role={banner.level === "INFO" ? "status" : "alert"} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", STYLES[banner.level])}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{banner.title}</p>
              <p className="text-muted-foreground whitespace-pre-line">{banner.body}</p>
            </div>
            {banner.kind === "billing" && banner.action ? (
              <Link href={banner.action.href} className="shrink-0 self-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                {banner.action.label}
              </Link>
            ) : null}
            {banner.kind === "announcement" && banner.level !== "CRITICAL" ? (
              <button type="button" onClick={() => dismiss(banner.id)} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground" aria-label={`Masquer l'annonce ${banner.title}`}>
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
