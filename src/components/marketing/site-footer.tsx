import Link from "next/link";
import { footerNav } from "@/config/marketing";
import { siteConfig } from "@/config/site";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-navy text-slate-300">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo tone="inverse" />
            <p className="mt-4 text-sm leading-relaxed text-slate-400">{siteConfig.description}</p>
            <p className="mt-4 text-sm">
              <a href={`mailto:${siteConfig.contactEmail}`} className="text-slate-200 underline-offset-4 hover:underline">
                {siteConfig.contactEmail}
              </a>
            </p>
          </div>
          {footerNav.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="font-sans text-sm font-semibold tracking-normal text-white">{group.title}</h2>
              <ul className="mt-4 grid gap-2.5 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-slate-400 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 grid gap-4 border-t border-white/10 pt-8 text-xs leading-relaxed text-slate-400 lg:grid-cols-[1fr_auto]">
          <p className="max-w-3xl">
            {siteConfig.name} est un logiciel de gestion et de tenue comptable. Il ne constitue pas une prestation
            d'expertise comptable ni un conseil fiscal ou juridique, et ne se substitue pas à l'intervention d'un
            professionnel inscrit à l'Ordre des experts-comptables.
          </p>
          <p className="lg:text-right">© {siteConfig.name}. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
}
