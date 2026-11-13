import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalDocument, type LegalSection } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: `Mentions légales du site ${siteConfig.name} : éditeur, hébergeur et propriété intellectuelle.`,
  alternates: { canonical: "/mentions-legales" },
};

const { legal } = siteConfig;

const sections: LegalSection[] = [
  {
    title: "Éditeur du site",
    list: [
      `Dénomination : ${legal.companyName}`,
      `Forme juridique et capital : ${legal.legalForm}`,
      `Siège social : ${legal.address}`,
      `SIREN : ${legal.siren} — RCS : ${legal.rcs}`,
      `Numéro de TVA intracommunautaire : ${legal.vatNumber}`,
      `Directeur de la publication : ${legal.publicationDirector}`,
      `Contact : ${siteConfig.contactEmail}`,
    ],
  },
  {
    title: "Hébergement",
    paragraphs: [`Le site et l'application sont hébergés par : ${legal.host}.`],
  },
  {
    title: "Nature du service",
    paragraphs: [
      `${siteConfig.name} est un logiciel en ligne de gestion, de facturation et de tenue comptable destiné aux entreprises françaises.`,
      "Le service ne constitue pas une prestation d'expertise comptable, de conseil fiscal ou de conseil juridique, et ne se substitue pas à l'intervention d'un professionnel inscrit à l'Ordre des experts-comptables. L'utilisateur reste seul responsable de ses déclarations et du respect de ses obligations comptables et fiscales.",
    ],
  },
  {
    title: "Propriété intellectuelle",
    paragraphs: [
      "L'ensemble des éléments du site (textes, interfaces, logos, illustrations, code) est protégé par le droit de la propriété intellectuelle. Toute reproduction ou représentation, totale ou partielle, sans autorisation écrite préalable est interdite.",
      "Les données saisies par les utilisateurs dans l'application demeurent leur propriété.",
    ],
  },
  {
    title: "Données personnelles et cookies",
    paragraphs: [
      "Le traitement des données personnelles est décrit dans la politique de confidentialité. Le site n'utilise que des cookies strictement nécessaires à son fonctionnement (session authentifiée, préférence de thème) : ils ne requièrent pas de consentement préalable.",
    ],
  },
  {
    title: "Droit applicable",
    paragraphs: ["Le présent site est soumis au droit français. À défaut de résolution amiable, tout litige relève des juridictions compétentes."],
  },
];

export default function LegalNoticePage() {
  return (
    <LegalDocument
      title="Mentions légales"
      description="Informations relatives à l'éditeur et à l'hébergeur du site, conformément à la loi pour la confiance dans l'économie numérique."
      updatedAt="13 novembre 2026"
      sections={sections}
    />
  );
}
