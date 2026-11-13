import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalDocument, type LegalSection } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation et de vente",
  description: `Conditions générales d'utilisation et de vente du service ${siteConfig.name}.`,
  alternates: { canonical: "/cgu-cgv" },
};

const name = siteConfig.name;

const sections: LegalSection[] = [
  {
    title: "Objet",
    paragraphs: [
      `Les présentes conditions générales régissent l'accès au service en ligne ${name} et son utilisation, ainsi que la souscription des abonnements payants. Elles s'appliquent à tout utilisateur professionnel qui crée un compte.`,
      "La création d'un compte vaut acceptation sans réserve des présentes conditions.",
    ],
  },
  {
    title: "Description du service",
    paragraphs: [
      `${name} est un logiciel en mode SaaS de facturation, de suivi bancaire, de tenue comptable, de suivi de la TVA et de gestion documentaire.`,
      "Le service est un outil : il ne fournit ni prestation d'expertise comptable, ni conseil fiscal, juridique ou social. Les calculs et documents produits reposent sur les informations saisies par l'utilisateur, qui lui appartient de vérifier, le cas échéant avec un professionnel du chiffre.",
    ],
  },
  {
    title: "Compte utilisateur et sécurité",
    list: [
      "L'utilisateur fournit des informations exactes et les tient à jour.",
      "Il est responsable de la confidentialité de ses identifiants et de l'activité réalisée depuis son compte. L'activation de la double authentification est recommandée.",
      "Le titulaire du compte décide des personnes invitées dans ses entreprises et des rôles qui leur sont attribués.",
      "Toute utilisation frauduleuse ou tout accès non autorisé doit être signalé sans délai.",
    ],
  },
  {
    title: "Période d'essai",
    paragraphs: [
      "Chaque formule peut être testée gratuitement pendant la durée indiquée sur la page Tarifs, sans moyen de paiement. À l'issue de l'essai, l'accès aux fonctionnalités payantes est subordonné à la souscription d'un abonnement.",
    ],
  },
  {
    title: "Abonnements, prix et paiement",
    list: [
      "Les formules, leurs fonctionnalités et leurs prix hors taxes sont présentés sur la page Tarifs ; la TVA s'ajoute au taux en vigueur.",
      "L'abonnement est mensuel ou annuel, payable d'avance par prélèvement sur le moyen de paiement enregistré auprès de notre prestataire de paiement.",
      "Il se renouvelle tacitement pour une durée identique, sauf résiliation avant l'échéance.",
      "En cas d'échec de paiement, l'utilisateur est informé et dispose d'un délai pour régulariser avant suspension des fonctionnalités payantes.",
      "Toute évolution tarifaire est notifiée au moins trente jours avant son entrée en vigueur et s'applique à la période d'abonnement suivante.",
    ],
  },
  {
    title: "Changement de formule et résiliation",
    paragraphs: [
      "L'utilisateur peut changer de formule ou résilier son abonnement à tout moment depuis son espace. La résiliation prend effet à la fin de la période en cours ; les sommes déjà versées restent acquises, sauf disposition légale contraire.",
      "Après résiliation, les données restent exportables pendant le délai indiqué dans la politique de confidentialité.",
    ],
  },
  {
    title: "Obligations de l'utilisateur",
    list: [
      "Utiliser le service conformément à sa destination et à la réglementation applicable.",
      "S'assurer de l'exactitude des données saisies et procéder lui-même à ses déclarations fiscales et sociales.",
      "Conserver ses pièces justificatives pendant les durées légales.",
      "Ne pas tenter d'accéder aux données d'autres clients ni de porter atteinte à la sécurité du service.",
    ],
  },
  {
    title: "Disponibilité et maintenance",
    paragraphs: [
      "L'éditeur met en œuvre les moyens raisonnables pour assurer la disponibilité du service, sans garantie d'absence d'interruption. Des opérations de maintenance peuvent entraîner une indisponibilité temporaire, annoncée lorsque cela est possible.",
    ],
  },
  {
    title: "Responsabilité",
    paragraphs: [
      "L'éditeur est tenu d'une obligation de moyens. Il ne saurait être responsable des conséquences d'une saisie erronée, d'un défaut de déclaration, d'une utilisation non conforme du service ou des décisions prises sur la base des indicateurs affichés.",
      "Dans les limites permises par la loi, la responsabilité de l'éditeur est plafonnée au montant des sommes versées par l'utilisateur au cours des douze derniers mois.",
    ],
  },
  {
    title: "Données et réversibilité",
    paragraphs: [
      "L'utilisateur reste propriétaire de ses données et peut les exporter à tout moment dans des formats standards. Les traitements de données personnelles sont décrits dans la politique de confidentialité ; lorsque l'éditeur agit comme sous-traitant, un accord de traitement des données complète les présentes conditions.",
    ],
  },
  {
    title: "Modification des conditions",
    paragraphs: [
      "Les présentes conditions peuvent être modifiées. Les utilisateurs sont informés de toute modification substantielle avant son entrée en vigueur ; la poursuite de l'utilisation du service vaut acceptation.",
    ],
  },
  {
    title: "Droit applicable et litiges",
    paragraphs: [
      "Les présentes conditions sont soumises au droit français. Les parties recherchent une solution amiable avant toute action ; à défaut, le litige est porté devant les juridictions compétentes du ressort du siège social de l'éditeur.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Conditions générales d'utilisation et de vente"
      description={`Les règles qui encadrent l'utilisation de ${name} et la souscription de ses abonnements.`}
      updatedAt="13 novembre 2026"
      sections={sections}
    />
  );
}
