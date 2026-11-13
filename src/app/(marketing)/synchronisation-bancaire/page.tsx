import type { Metadata } from "next";
import { Container, CtaBanner, HeroActions, MockPanel, Notice, PageHero, Section, SplitBlock } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Synchronisation bancaire",
  description:
    "Importez vos relevés CSV, OFX ou CAMT, catégorisez vos opérations avec des règles automatiques et rapprochez-les de vos factures et justificatifs.",
  alternates: { canonical: "/synchronisation-bancaire" },
};

export default function BankPage() {
  return (
    <>
      <PageHero
        eyebrow="Banque"
        title="Vos opérations bancaires, classées et justifiées"
        description="Importez vos relevés, laissez les règles proposer une catégorie et rapprochez chaque mouvement d'une facture ou d'un justificatif."
      >
        <HeroActions />
      </PageHero>

      <Section>
        <Container className="grid gap-20">
          <SplitBlock
            eyebrow="Import et catégorisation"
            title="Du relevé à l'opération catégorisée"
            description="Les formats de relevés les plus courants sont pris en charge. Les doublons sont détectés à l'import et vos règles de catégorisation s'appliquent automatiquement."
            items={[
              "Import de relevés CSV, OFX et CAMT.053",
              "Détection des doublons à l'import",
              "Règles automatiques : libellé, montant, sens de l'opération",
              "Recherche et filtres par compte, période, catégorie et statut",
              "Historique des modifications de chaque opération",
            ]}
            aside={
              <MockPanel
                title="Opérations à traiter"
                badge="3 à catégoriser"
                rows={[
                  { label: "VIR MAISON VERDIER F-2026-0042", value: "+5 712,00 €", tone: "success" },
                  { label: "PRLV OPÉRATEUR TÉLÉCOM", value: "−115,20 €" },
                  { label: "CB PAPETERIE CENTRALE", value: "−84,90 €", tone: "warning" },
                  { label: "FRAIS TENUE DE COMPTE", value: "−18,50 €" },
                ]}
              />
            }
          />

          <SplitBlock
            reverse
            eyebrow="Rapprochement"
            title="Chaque mouvement trouve sa pièce"
            description="Associez un encaissement à la facture qu'il règle, un décaissement à son justificatif. Les opérations sans pièce sont signalées dans votre tableau de bord."
            items={[
              "Rapprochement des encaissements avec vos factures",
              "Affectation de justificatifs aux dépenses",
              "Identification des opérations non justifiées",
              "Solde bancaire et trésorerie disponible mis à jour",
            ]}
            aside={
              <MockPanel
                title="État du rapprochement"
                rows={[
                  { label: "Opérations rapprochées", value: "212", tone: "success" },
                  { label: "Sans justificatif", value: "7", tone: "warning" },
                  { label: "Doublons écartés à l'import", value: "4", tone: "muted" },
                  { label: "Solde du compte", value: "51 310,42 €" },
                ]}
              />
            }
          />
        </Container>
      </Section>

      <Section className="border-y bg-card">
        <Container className="grid gap-6 lg:grid-cols-2">
          <Notice title="Vos identifiants bancaires ne nous sont jamais confiés">
            Nous ne demandons ni ne conservons vos identifiants et mots de passe bancaires. Aujourd'hui, vous importez vos
            relevés depuis l'espace client de votre banque.
          </Notice>
          <Notice title="Synchronisation automatique : via un prestataire agréé">
            La récupération automatique des opérations sera assurée par un prestataire de services d'information sur les
            comptes agréé (DSP2). Vous vous authentifierez directement auprès de votre banque et pourrez révoquer l'accès
            à tout moment. Cette connexion est en cours d'intégration.
          </Notice>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
