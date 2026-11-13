import type { Metadata } from "next";
import { Container, CtaBanner, HeroActions, MockPanel, Notice, PageHero, Section, SplitBlock } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Logiciel de facturation",
  description:
    "Devis, factures, acomptes, avoirs et factures récurrentes avec numérotation chronologique, suivi des règlements et relances.",
  alternates: { canonical: "/facturation" },
};

export default function InvoicingPage() {
  return (
    <>
      <PageHero
        eyebrow="Facturation"
        title="Des factures conformes, des encaissements suivis"
        description="Créez vos devis et factures en quelques clics, transformez l'un en l'autre et gardez un œil sur ce qui reste à encaisser."
      >
        <HeroActions />
      </PageHero>

      <Section>
        <Container className="grid gap-20">
          <SplitBlock
            eyebrow="Du devis à la facture"
            title="Un enchaînement sans ressaisie"
            description="Un devis accepté devient une facture d'acompte ou une facture définitive, avec les mêmes lignes, le même client et les mêmes conditions."
            items={[
              "Devis, factures, factures d'acompte et avoirs",
              "Catalogue de produits et prestations avec taux de TVA",
              "Remises par ligne ou globales, conditions de paiement",
              "Factures récurrentes pour vos abonnements et contrats",
            ]}
            aside={
              <MockPanel
                title="Facture F-2026-0042"
                badge="Envoyée"
                rows={[
                  { label: "Développement de site vitrine", value: "3 800,00 €" },
                  { label: "Maintenance mensuelle × 3", value: "960,00 €" },
                  { label: "Total HT", value: "4 760,00 €" },
                  { label: "TVA 20 %", value: "952,00 €", tone: "muted" },
                  { label: "Total TTC", value: "5 712,00 €", tone: "success" },
                ]}
              />
            }
          />

          <SplitBlock
            reverse
            eyebrow="Conformité"
            title="Une numérotation et des mentions maîtrisées"
            description="Les numéros sont attribués à l'émission, dans une suite chronologique continue. Une facture émise est verrouillée : elle se corrige par un avoir, jamais par une modification silencieuse."
            items={[
              "Numérotation chronologique sans rupture ni doublon",
              "Mentions obligatoires selon votre statut et votre régime de TVA",
              "Mention de franchise en base pour les micro-entreprises",
              "Historique des envois et des modifications de brouillons",
            ]}
            aside={
              <MockPanel
                title="Suivi des règlements"
                rows={[
                  { label: "Encaissé ce mois-ci", value: "12 480,00 €", tone: "success" },
                  { label: "En attente de règlement", value: "7 140,00 €" },
                  { label: "En retard de paiement", value: "1 920,00 €", tone: "warning" },
                  { label: "Prochaine relance", value: "dans 2 jours", tone: "muted" },
                ]}
              />
            }
          />
        </Container>
      </Section>

      <Section className="border-y bg-card">
        <Container className="grid gap-6 lg:grid-cols-2">
          <Notice title="Facturation électronique : ce qu'il faut savoir">
            La réforme impose des factures dans un format structuré (Factur-X, UBL ou CII), transmises par une plateforme
            agréée. <strong className="text-foreground">Un PDF envoyé par e-mail ne suffit pas</strong> à répondre à cette
            obligation. Notre modèle de données intègre déjà les informations requises (SIREN du client, nature de
            l'opération, exigibilité de la TVA) et le raccordement à une plateforme agréée sera proposé dès sa mise en
            service.
          </Notice>
          <Notice title="Export et portabilité">
            Vos factures, clients et règlements s'exportent au format CSV. Les documents PDF générés restent accessibles
            et téléchargeables pendant toute la durée de conservation légale.
          </Notice>
        </Container>
      </Section>

      <CtaBanner title="Émettez votre première facture aujourd'hui" />
    </>
  );
}
