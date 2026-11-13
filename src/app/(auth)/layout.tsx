import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const highlights = [
  "Facturation, banque, comptabilité et TVA dans un seul espace",
  "Indicateurs calculés à partir de vos données réelles",
  "Double authentification et données cloisonnées par entreprise",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-grid" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 size-[560px] rounded-full bg-primary/40 blur-[120px]" aria-hidden="true" />
        <Link href="/" className="relative" aria-label="Retour à l'accueil">
          <Logo tone="inverse" />
        </Link>
        <div className="relative my-auto max-w-md">
          <p className="font-display text-3xl leading-tight font-bold text-balance">
            La gestion de votre entreprise, claire et à jour.
          </p>
          <ul className="mt-8 grid gap-4 text-slate-200">
            {highlights.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-400">
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">
          Logiciel de gestion et de tenue comptable — ne se substitue pas à un expert-comptable.
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between p-4 sm:p-6">
          <Link href="/" className="lg:invisible" aria-label="Retour à l'accueil">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-6">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
