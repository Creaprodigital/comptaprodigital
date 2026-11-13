import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/** Emblème original : trois barres ascendantes et un point vert, dans un carré arrondi bleu. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} role="img" aria-label={siteConfig.name}>
      <defs>
        <linearGradient id="cpd-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#cpd-logo)" />
      <rect x="9" y="22" width="5.5" height="9" rx="2" fill="#fff" opacity="0.7" />
      <rect x="17.25" y="16" width="5.5" height="15" rx="2" fill="#fff" opacity="0.88" />
      <rect x="25.5" y="12" width="5.5" height="19" rx="2" fill="#fff" />
      <circle cx="28.25" cy="7.5" r="2.6" fill="#10B981" />
    </svg>
  );
}

export function Logo({ className, tone = "default" }: { className?: string; tone?: "default" | "inverse" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span
        className={cn(
          "font-display text-[17px] leading-none font-bold tracking-tight",
          tone === "inverse" ? "text-white" : "text-foreground",
        )}
      >
        ComptaPro <span className={tone === "inverse" ? "text-emerald-400" : "text-primary"}>Digital</span>
      </span>
    </span>
  );
}
