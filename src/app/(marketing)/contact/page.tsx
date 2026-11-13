import type { Metadata } from "next";
import { ClockIcon, LifeBuoyIcon, MailIcon } from "lucide-react";
import { siteConfig } from "@/config/site";
import { ContactForm } from "@/components/marketing/contact-form";
import { Container, PageHero, Section } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Contact",
  description: "Une question sur ComptaPro Digital, les formules ou votre compte ? Écrivez à notre équipe.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Parlons de votre gestion"
        description="Une question sur le produit, les formules ou votre compte ? Notre équipe vous répond par e-mail."
      />
      <Section>
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="grid content-start gap-5">
            {[
              { icon: MailIcon, title: "Par e-mail", text: siteConfig.contactEmail },
              { icon: ClockIcon, title: "Délai de réponse", text: "Nous répondons aux demandes par ordre d'arrivée, les jours ouvrés." },
              { icon: LifeBuoyIcon, title: "Déjà client ?", text: "Indiquez l'adresse e-mail de votre compte pour un traitement plus rapide." },
            ].map((item) => (
              <div key={item.title} className="flex gap-4 rounded-2xl border bg-card p-5 shadow-card">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-sans text-base font-semibold tracking-normal">{item.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
            <h2 className="text-xl font-bold">Écrivez-nous</h2>
            <p className="mt-1.5 mb-6 text-sm text-muted-foreground">Les champs marqués d'un astérisque sont obligatoires.</p>
            <ContactForm />
          </div>
        </Container>
      </Section>
    </>
  );
}
