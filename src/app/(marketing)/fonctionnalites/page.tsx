import type { Metadata } from "next";
import { coreFeatures, extendedFeatures } from "@/config/marketing";
import { Container, CtaBanner, FeatureGrid, HeroActions, Notice, PageHero, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Fonctionnalités",
  description:
    "Facturation, banque, comptabilité, TVA, documents et pilotage : découvrez les fonctionnalités de ComptaPro Digital pour les indépendants et les petites entreprises.",
  alternates: { canonical: "/fonctionnalites" },
};

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Fonctionnalités"
        title="Une plateforme, toute votre gestion"
        description="De la première facture à la clôture de l'exercice, chaque module alimente les autres : vous saisissez une fois, vos chiffres se mettent à jour partout."
      >
        <HeroActions />
      </PageHero>

      <Section>
        <Container>
          <SectionHeading eyebrow="Les essentiels" title="Les six piliers de votre gestion" />
          <div className="mt-12">
            <FeatureGrid features={coreFeatures} />
          </div>
        </Container>
      </Section>

      <Section className="border-y bg-card">
        <Container>
          <SectionHeading
            eyebrow="Et aussi"
            title="Conçu pour travailler sereinement, seul ou en équipe"
            description="Sécurité, collaboration et portabilité de vos données font partie du socle."
          />
          <div className="mt-12">
            <FeatureGrid features={extendedFeatures} />
          </div>
        </Container>
      </Section>

      <Section>
        <Container className="max-w-3xl">
          <Notice title="Un logiciel, pas un cabinet comptable">
            ComptaPro Digital vous outille pour tenir votre gestion et votre comptabilité. Il ne remplace pas le conseil
            d'un expert-comptable, que vous pouvez inviter directement dans votre espace avec un rôle dédié.
          </Notice>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
