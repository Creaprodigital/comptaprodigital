"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { mainNav } from "@/config/marketing";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Accueil ComptaPro Digital" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Navigation principale" className="hidden flex-1 items-center gap-1 lg:flex">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname === item.href && "bg-muted text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/connexion">Connexion</Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/inscription">Essayer gratuitement</Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-card p-6">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navigation du site</SheetDescription>
              <Logo />
              <nav aria-label="Navigation mobile" className="mt-8 flex flex-col gap-1">
                {[...mainNav, { label: "Solutions", href: "/solutions" }, { label: "Blog", href: "/blog" }, { label: "FAQ", href: "/faq" }, { label: "Contact", href: "/contact" }].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-muted",
                      pathname === item.href && "bg-muted",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto grid gap-2 pt-6">
                <Button asChild variant="outline" size="lg">
                  <Link href="/connexion" onClick={() => setOpen(false)}>Connexion</Link>
                </Button>
                <Button asChild size="lg">
                  <Link href="/inscription" onClick={() => setOpen(false)}>Essayer gratuitement</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
