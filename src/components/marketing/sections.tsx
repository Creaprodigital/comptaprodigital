import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import type { Feature } from "@/config/marketing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

export function Section({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("py-16 sm:py-24", className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm font-semibold tracking-wide text-primary uppercase", className)}>{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Tag className="mt-3 text-3xl leading-tight font-bold text-balance sm:text-4xl">{title}</Tag>
      {description ? <p className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** En-tête des pages intérieures du site vitrine. */
export function PageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden bg-navy text-white">
      <div className="absolute inset-0 bg-grid" aria-hidden="true" />
      <div
        className="absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-primary/30 blur-[120px]"
        aria-hidden="true"
      />
      <Container className="relative py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold tracking-wide text-emerald-400 uppercase">{eyebrow}</p>
          <h1 className="mt-4 text-4xl leading-[1.1] font-bold text-balance sm:text-5xl">{title}</h1>
          <p className="mt-6 text-lg leading-relaxed text-pretty text-slate-300">{description}</p>
          {children ? <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div> : null}
        </div>
      </Container>
    </div>
  );
}

export function HeroActions() {
  return (
    <>
      <Button asChild size="lg" variant="success">
        <Link href="/inscription">
          Essayer gratuitement <ArrowRightIcon />
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline-inverse">
        <Link href="/tarifs">Voir les tarifs</Link>
      </Button>
    </>
  );
}

export function FeatureGrid({ features, columns = 3 }: { features: Feature[]; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
      {features.map((feature) => {
        const content = (
          <>
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary">
              <feature.icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{feature.description}</p>
            {feature.href ? (
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                En savoir plus <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            ) : null}
          </>
        );
        const classes = "group rounded-2xl border bg-card p-6 shadow-card transition-all";
        return feature.href ? (
          <Link key={feature.title} href={feature.href} className={cn(classes, "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated")}>
            {content}
          </Link>
        ) : (
          <div key={feature.title} className={classes}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function CheckList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-[15px] leading-relaxed">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-foreground">
            <CheckIcon className="size-3.5" aria-hidden="true" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bloc « texte + liste » alterné, utilisé sur les pages produit. */
export function SplitBlock({
  eyebrow,
  title,
  description,
  items,
  aside,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: readonly string[];
  aside: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn(reverse && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3 text-3xl leading-tight font-bold text-balance">{title}</h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{description}</p>
        <CheckList items={items} className="mt-6" />
      </div>
      <div className={cn(reverse && "lg:order-1")}>{aside}</div>
    </div>
  );
}

/** Encadré d'information (rappels réglementaires, limites du service). */
export function Notice({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <aside className={cn("rounded-2xl border border-primary/20 bg-accent p-6", className)}>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </aside>
  );
}

export function CtaBanner({
  title = "Prêt à simplifier votre gestion ?",
  description = "Créez votre compte en quelques minutes. Sans carte bancaire, sans engagement.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Section className="pt-0 sm:pt-0">
      <Container>
        <div className="relative overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center text-white sm:px-12">
          <div className="absolute inset-0 bg-grid" aria-hidden="true" />
          <div className="absolute -bottom-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/40 blur-[110px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl leading-tight font-bold text-balance sm:text-4xl">{title}</h2>
            <p className="mt-4 text-lg text-slate-300">{description}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="success">
                <Link href="/inscription">
                  Essayer gratuitement <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline-inverse">
                <Link href="/contact">Nous contacter</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

/** Carte illustrative : liste de lignes « libellé / valeur ». */
export function MockPanel({
  title,
  badge,
  rows,
  footer,
}: {
  title: string;
  badge?: string;
  rows: Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "muted" }>;
  footer?: string;
}) {
  const tones = {
    default: "text-foreground",
    success: "text-success-foreground",
    warning: "text-warning-foreground",
    muted: "text-muted-foreground",
  };
  return (
    <figure className="rounded-2xl border bg-card p-6 shadow-elevated">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="font-display text-base font-semibold">{title}</span>
        {badge ? <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{badge}</span> : null}
      </figcaption>
      <dl className="mt-5 divide-y">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-3 text-sm">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={cn("tabular font-semibold", tones[row.tone ?? "default"])}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">{footer ?? "Exemple d'affichage — données d'illustration."}</p>
    </figure>
  );
}
