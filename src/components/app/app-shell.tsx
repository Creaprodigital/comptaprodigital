"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/app/notification-bell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type ShellUser = { firstName: string; lastName: string; email: string };
export type ShellCompany = { id: string; name: string; roleName: string };

type NavItem = { label: string; href: string; icon: LucideIcon; requiresCompany?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Pilotage",
    items: [{ label: "Tableau de bord", href: "/app/tableau-de-bord", icon: LayoutDashboardIcon, requiresCompany: true }],
  },
  {
    title: "Entreprise",
    items: [
      { label: "Paramètres", href: "/app/entreprise/parametres", icon: Settings2Icon, requiresCompany: true },
      { label: "Équipe et accès", href: "/app/entreprise/equipe", icon: UsersIcon, requiresCompany: true },
    ],
  },
  {
    title: "Compte",
    items: [
      { label: "Mes entreprises", href: "/app/entreprises", icon: Building2Icon },
      { label: "Compte et sécurité", href: "/app/compte", icon: UserCogIcon },
    ],
  },
];

async function switchCompany(companyId: string) {
  try {
    await api("/me/active-company", { method: "PUT", body: { companyId } });
    window.location.assign("/app/tableau-de-bord");
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    window.location.assign("/connexion");
  }
}

function CompanySwitcher({ companies, activeId }: { companies: ShellCompany[]; activeId: string | null }) {
  const active = companies.find((c) => c.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5 text-left transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
            <Building2Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{active?.name ?? "Aucune entreprise"}</span>
            <span className="block truncate text-xs text-sidebar-muted">{active?.roleName ?? "Ajoutez votre entreprise"}</span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
          <span className="sr-only">Changer d'entreprise</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Vos entreprises</DropdownMenuLabel>
        {companies.map((company) => (
          <DropdownMenuItem key={company.id} onSelect={() => company.id !== activeId && switchCompany(company.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{company.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{company.roleName}</span>
            </span>
            {company.id === activeId ? <CheckIcon className="!text-primary" aria-label="Entreprise active" /> : null}
          </DropdownMenuItem>
        ))}
        {companies.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link href="/app/entreprises?nouvelle=1">
            <PlusIcon /> Ajouter une entreprise
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContent({
  companies,
  activeId,
  onNavigate,
}: {
  companies: ShellCompany[];
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const hasCompany = activeId !== null;
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <Link href="/app/tableau-de-bord" onClick={onNavigate} className="flex items-center gap-2.5 px-1.5 pt-1" aria-label="Tableau de bord">
        <LogoMark className="size-8" />
        <span className="font-display text-base font-bold text-white">
          ComptaPro <span className="text-emerald-400">Digital</span>
        </span>
      </Link>

      <CompanySwitcher companies={companies} activeId={activeId} />

      <nav aria-label="Navigation de l'espace client" className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.title}>
            <p className="px-3 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{group.title}</p>
            <ul className="mt-2 grid gap-0.5">
              {group.items
                .filter((item) => hasCompany || !item.requiresCompany)
                .map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none hover:bg-sidebar-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
                          active && "bg-sidebar-accent text-white shadow-[inset_3px_0_0_0_var(--success)]",
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

      <p className="flex items-start gap-2 rounded-xl border border-sidebar-border px-3 py-2.5 text-xs leading-relaxed text-sidebar-muted">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
        Données cloisonnées par entreprise et connexions chiffrées.
      </p>
    </div>
  );
}

export function AppShell({
  user,
  companies,
  activeCompanyId,
  children,
}: {
  user: ShellUser;
  companies: ShellCompany[];
  activeCompanyId: string | null;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
        <SidebarContent companies={companies} activeId={activeCompanyId} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="text-white">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navigation de l'espace client</SheetDescription>
              <SidebarContent companies={companies} activeId={activeCompanyId} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground lg:hidden">
            {companies.find((c) => c.id === activeCompanyId)?.name}
          </p>
          <div className="hidden flex-1 lg:block" />

          <ThemeToggle />
          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Menu du compte"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {initials(user.firstName, user.lastName)}
                </span>
                <span className="hidden text-sm font-medium sm:block">{user.firstName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-semibold">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/app/compte">
                  <UserCogIcon /> Compte et sécurité
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/app/entreprises">
                  <Building2Icon /> Mes entreprises
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={logout}>
                <LogOutIcon /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
