import type { Metadata } from "next";
import { Container, CtaBanner, HeroActions, MockPanel, Notice, PageHero, Section, SplitBlock } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Gestion de la TVA",
  description:
    "Suivi de la TVA collectée et déductible selon votre régime, préparation des déclarations CA3 et CA12, alertes d'échéance et simulation des montants.",
  alternates: { canonical: "/gestion-tva" },
};

export default function VatPage() {
  return (
    <>
      <PageHero
        eyebrow="TVA"
        title="Votre TVA suivie au fil de l'eau, sans mauvaise surprise"
        description="La TVA collectée et la TVA déductible se calculent à partir de vos factures, règlements et achats, selon votre régime et vos règles d'exigibilité."
      >
        <HeroActions />
      </PageHero>

      <Section>
        <Container className="grid gap-20">
          <SplitBlock
            eyebrow="Calcul"
            title="Les bonnes règles, appliquées à chaque opération"
            description="Franchise en base, réel simplifié ou réel normal : le suivi s'adapte à votre régime. L'exigibilité est gérée facture par facture, sur les débits ou sur les encaissements."
            items={[
              "TVA collectée et déductible par taux",
              "Exigibilité sur les débits ou sur les encaissements",
              "Prise en compte des règlements partiels au prorata",
              "Franchise en base : aucune TVA facturée, mention légale sur les factures",
            ]}
            aside={
              <MockPanel
                title="Période : octobre 2026"
                badge="En préparation"
                rows={[
                  { label: "TVA collectée", value: "3 184,00 €" },
                  { label: "TVA déductible", value: "−1 046,20 €" },
                  { label: "Crédit reporté", value: "0,00 €", tone: "muted" },
                  { label: "TVA à payer (estimation)", value: "2 137,80 €", tone: "warning" },
                ]}
              />
            }
          />

          <SplitBlock
            reverse
            eyebrow="Déclaration"
            title="Des périodes préparées, validées, archivées"
            description="Chaque période de TVA regroupe les montants à reporter sur votre déclaration. Vous la contrôlez, la validez, puis conservez l'historique et le détail des opérations."
            items={[
              "Préparation des déclarations CA3 et CA12",
              "Alertes avant chaque échéance",
              "Simulation du montant à payer en cours de période",
              "Historique des périodes et export du détail",
            ]}
            aside={
              <MockPanel
                title="Échéances"
                rows={[
                  { label: "CA3 d'octobre", value: "du 15 au 24 novembre", tone: "warning" },
                  { label: "CA3 de septembre", value: "validée", tone: "success" },
                  { label: "CA3 d'août", value: "validée", tone: "success" },
                ]}
              />
            }
          />
        </Container>
      </Section>

      <Section className="border-y bg-card">
        <Container className="grid gap-6 lg:grid-cols-2">
          <Notice title="Aucune télétransmission automatique">
            La plateforme prépare vos déclarations mais ne les transmet pas à l'administration. Le dépôt reste effectué
            par vos soins sur votre espace professionnel impots.gouv.fr, ou par votre expert-comptable, après votre
            contrôle et votre validation explicite.
          </Notice>
          <Notice title="Des montants à faire vérifier">
            Les calculs reposent sur les informations que vous saisissez. Les situations particulières (opérations
            intracommunautaires, autoliquidation, prorata de déduction, secteurs distincts) doivent être examinées avec un
            professionnel.
          </Notice>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
