"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BadgeEuroIcon,
  Building2Icon,
  BugIcon,
  CreditCardIcon,
  GaugeIcon,
  LayersIcon,
  LifeBuoyIcon,
  MailIcon,
  MegaphoneIcon,
  MenuIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };

const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Activité",
    items: [
      { label: "Vue d'ensemble", href: "/admin", icon: GaugeIcon, exact: true },
      { label: "Revenus", href: "/admin/revenus", icon: BadgeEuroIcon },
    ],
  },
  {
    title: "Clients",
    items: [
      { label: "Comptes", href: "/admin/clients", icon: UsersIcon },
      { label: "Entreprises", href: "/admin/entreprises", icon: Building2Icon },
      { label: "Abonnements", href: "/admin/abonnements", icon: CreditCardIcon },
      { label: "Formules", href: "/admin/formules", icon: LayersIcon },
      { label: "Support", href: "/admin/support", icon: LifeBuoyIcon },
    ],
  },
  {
    title: "Plateforme",
    items: [
      { label: "Annonces", href: "/admin/annonces", icon: MegaphoneIcon },
      { label: "E-mails", href: "/admin/emails", icon: MailIcon },
      { label: "Intégrations", href: "/admin/integrations", icon: ActivityIcon },
      { label: "Erreurs", href: "/admin/erreurs", icon: BugIcon },
      { label: "Journal d'audit", href: "/admin/audit", icon: ScrollTextIcon },
      { label: "Paramètres", href: "/admin/parametres", icon: SlidersHorizontalIcon },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <Link href="/admin" onClick={onNavigate} className="flex items-center gap-2.5 px-1.5 pt-1">
        <LogoMark className="size-8" />
        <span className="leading-tight">
          <span className="block font-display text-base font-bold text-white">ComptaPro Digital</span>
          <span className="block text-[11px] font-semibold tracking-wider text-amber-300 uppercase">Administration</span>
        </span>
      </Link>
      <nav aria-label="Navigation de l'administration" className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.title}>
            <p className="px-3 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{group.title}</p>
            <ul className="mt-2 grid gap-0.5">
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none hover:bg-sidebar-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-sidebar-accent text-white shadow-[inset_3px_0_0_0_#fbbf24]",
                      )}
                    >
                      <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Link href="/app/tableau-de-bord" onClick={onNavigate} className="flex items-center gap-3 rounded-lg border border-sidebar-border px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-white">
        <ArrowLeftIcon className="size-[18px]" aria-hidden="true" /> Retour à l'espace client
      </Link>
      <p className="flex items-start gap-2 rounded-xl border border-sidebar-border px-3 py-2.5 text-xs leading-relaxed text-sidebar-muted">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        Chaque action est inscrite au journal d'audit. Les données financières des clients ne sont accessibles que sur accès justifié.
      </p>
    </div>
  );
}

export function AdminShell({ admin, children }: { admin: { name: string; email: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="text-white">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navigation de l'administration</SheetDescription>
              <Sidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            Connecté en tant qu'administrateur : <span className="font-medium text-foreground">{admin.name}</span>
          </p>
          <ThemeToggle />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
