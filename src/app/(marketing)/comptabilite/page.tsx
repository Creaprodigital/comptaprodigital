import type { Metadata } from "next";
import { Container, CtaBanner, HeroActions, MockPanel, Notice, PageHero, Section, SplitBlock } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Comptabilité en ligne",
  description:
    "Plan comptable général, journaux, grand livre, balance, clôture d'exercice et export FEC : une comptabilité en partie double traçable.",
  alternates: { canonical: "/comptabilite" },
};

export default function AccountingPage() {
  return (
    <>
      <PageHero
        eyebrow="Comptabilité"
        title="Une comptabilité tenue en continu, traçable de bout en bout"
        description="Vos factures, achats et mouvements bancaires se traduisent en écritures équilibrées. Vous et votre expert-comptable travaillez sur les mêmes chiffres."
      >
        <HeroActions />
      </PageHero>

      <Section>
        <Container className="grid gap-20">
          <SplitBlock
            eyebrow="Partie double"
            title="Les états comptables dont vous avez besoin"
            description="Chaque écriture respecte l'équilibre débit-crédit et s'inscrit dans un journal. Les états se construisent à partir de ces écritures, sans retraitement manuel."
            items={[
              "Plan comptable général configurable",
              "Journaux de ventes, d'achats, de banque et d'opérations diverses",
              "Grand livre et balance générale",
              "Comptes clients et fournisseurs, lettrage",
              "Immobilisations et tableaux d'amortissement",
            ]}
            aside={
              <MockPanel
                title="Écriture VT-000128"
                badge="Validée"
                rows={[
                  { label: "411000 Clients — débit", value: "5 712,00 €" },
                  { label: "706000 Prestations — crédit", value: "4 760,00 €" },
                  { label: "445710 TVA collectée — crédit", value: "952,00 €" },
                  { label: "Équilibre", value: "0,00 €", tone: "success" },
                ]}
              />
            }
          />

          <SplitBlock
            reverse
            eyebrow="Intégrité"
            title="Une écriture validée ne se modifie pas"
            description="La validation fige l'écriture et lui attribue un numéro séquentiel. Une erreur se corrige par une écriture de contre-passation, visible et datée : c'est le principe d'intangibilité."
            items={[
              "Brouillard modifiable, puis validation définitive",
              "Correction par contre-passation, jamais par effacement",
              "Verrouillage des périodes et clôture d'exercice",
              "Journal d'audit des actions sensibles",
              "Export du fichier des écritures comptables (FEC)",
            ]}
            aside={
              <MockPanel
                title="Exercice 2026"
                badge="Ouvert"
                rows={[
                  { label: "Période verrouillée jusqu'au", value: "30/09/2026" },
                  { label: "Écritures validées", value: "1 284" },
                  { label: "Écritures au brouillard", value: "12", tone: "warning" },
                  { label: "Rapprochement bancaire", value: "à jour", tone: "success" },
                ]}
              />
            }
          />
        </Container>
      </Section>

      <Section className="border-y bg-card">
        <Container className="grid gap-6 lg:grid-cols-2">
          <Notice title="Adapté à votre régime">
            Les micro-entreprises disposent d'un livre des recettes et d'un registre des achats, conformes à leurs
            obligations allégées. Les sociétés et les entreprises au régime réel bénéficient de la comptabilité complète
            en partie double.
          </Notice>
          <Notice title="Le rôle de votre expert-comptable">
            La plateforme tient et structure vos écritures ; l'établissement des comptes annuels, la liasse fiscale et le
            conseil relèvent d'un professionnel. Invitez-le dans votre espace avec le rôle « Expert-comptable externe ».
          </Notice>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
