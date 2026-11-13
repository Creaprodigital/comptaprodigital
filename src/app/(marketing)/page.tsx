import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, LockKeyholeIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import { automationBenefits, coreFeatures, faqs, howItWorks } from "@/config/marketing";
import { siteConfig } from "@/config/site";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { FaqList } from "@/components/marketing/faq-list";
import { Pricing } from "@/components/marketing/pricing";
import { Container, CtaBanner, FeatureGrid, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: { absolute: `${siteConfig.name} — Comptabilité, facturation et TVA en ligne` },
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteConfig.name,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: siteConfig.description,
  url: siteConfig.url,
  inLanguage: "fr-FR",
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c") }} />

      {/* Hero */}
      <div className="relative overflow-hidden bg-navy text-white">
        <div className="absolute inset-0 bg-grid" aria-hidden="true" />
        <div className="absolute -top-48 left-1/2 size-[820px] -translate-x-1/2 rounded-full bg-primary/35 blur-[140px]" aria-hidden="true" />
        <Container className="relative pt-16 pb-12 sm:pt-24 sm:pb-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-slate-200">
              <SparklesIcon className="size-4 text-emerald-400" aria-hidden="true" />
              Pensé pour les indépendants, TPE et PME françaises
            </p>
            <h1 className="mt-6 text-4xl leading-[1.08] font-bold text-balance sm:text-6xl">
              Votre comptabilité avance <span className="text-emerald-400">en même temps que votre activité</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-slate-300">
              Facturez, suivez votre banque, préparez votre TVA et pilotez votre trésorerie depuis un seul espace.
              Chaque chiffre est calculé à partir de vos données, au fil de l'eau.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="success">
                <Link href="/inscription">
                  Essayer gratuitement <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline-inverse">
                <Link href="/fonctionnalites">Découvrir les fonctionnalités</Link>
              </Button>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
              <li className="flex items-center gap-1.5"><ShieldCheckIcon className="size-4 text-emerald-400" aria-hidden="true" />Sans carte bancaire</li>
              <li className="flex items-center gap-1.5"><LockKeyholeIcon className="size-4 text-emerald-400" aria-hidden="true" />Double authentification</li>
              <li className="flex items-center gap-1.5"><ShieldCheckIcon className="size-4 text-emerald-400" aria-hidden="true" />Données cloisonnées par entreprise</li>
            </ul>
          </div>
          <div className="mt-14">
            <DashboardPreview />
          </div>
        </Container>
      </div>

      {/* Fonctionnalités */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Fonctionnalités"
            title="Tout ce qu'il faut pour gérer une entreprise, au même endroit"
            description="Des modules qui se parlent : une facture émise met à jour vos encaissements, votre TVA et vos indicateurs."
          />
          <div className="mt-12">
            <FeatureGrid features={coreFeatures} />
          </div>
        </Container>
      </Section>

      {/* Automatisation */}
      <Section className="border-y bg-card">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <SectionHeading
              align="left"
              eyebrow="Automatisation"
              title="Moins de tâches répétitives, plus de visibilité"
              description="La plateforme enchaîne les étapes à votre place et vous signale ce qui mérite votre attention. Les décisions restent les vôtres."
            />
            <dl className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
              {automationBenefits.map((benefit, index) => (
                <div key={benefit.title} className="relative pl-12">
                  <span className="absolute top-0 left-0 flex size-9 items-center justify-center rounded-xl bg-primary font-display text-sm font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <dt className="font-display text-lg font-semibold">{benefit.title}</dt>
                  <dd className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{benefit.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      {/* Trois étapes */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Comment ça marche" title="Opérationnel en trois étapes" />
          <ol className="mt-12 grid gap-6 lg:grid-cols-3">
            {howItWorks.map((step, index) => (
              <li key={step.title} className="relative rounded-2xl border bg-card p-7 shadow-card">
                <span className="font-display text-5xl font-bold text-primary/15" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* Tarifs */}
      <Section className="border-y bg-card" id="tarifs">
        <Container>
          <SectionHeading
            eyebrow="Tarifs"
            title="Une formule pour chaque étape de votre entreprise"
            description="Essai gratuit sur toutes les formules. Changez ou résiliez à tout moment."
          />
          <div className="mt-10">
            <Pricing showComparison />
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section>
        <Container className="max-w-3xl">
          <SectionHeading eyebrow="Questions fréquentes" title="Vous vous demandez peut-être…" />
          <div className="mt-10">
            <FaqList items={faqs.slice(0, 6)} />
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            D'autres questions ?{" "}
            <Link href="/faq" className="font-semibold text-primary underline-offset-4 hover:underline">
              Consultez toute la FAQ
            </Link>{" "}
            ou{" "}
            <Link href="/contact" className="font-semibold text-primary underline-offset-4 hover:underline">
              écrivez-nous
            </Link>
            .
          </p>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
