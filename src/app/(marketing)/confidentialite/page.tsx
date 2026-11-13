import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalDocument, type LegalSection } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: `Comment ${siteConfig.name} collecte, utilise et protège les données personnelles, conformément au RGPD.`,
  alternates: { canonical: "/confidentialite" },
};

const { legal } = siteConfig;

const sections: LegalSection[] = [
  {
    title: "Responsable du traitement",
    paragraphs: [
      `${legal.companyName} (${legal.address}) est responsable du traitement des données relatives aux comptes utilisateurs, à la relation commerciale et au support.`,
      "Pour les données que vous saisissez dans vos entreprises (clients, fournisseurs, pièces), vous êtes responsable du traitement et nous agissons en qualité de sous-traitant, sur vos instructions.",
    ],
  },
  {
    title: "Données collectées",
    list: [
      "Données de compte : nom, prénom, adresse e-mail, numéro de téléphone, mot de passe (stocké sous forme d'empreinte Argon2id, jamais en clair).",
      "Données d'entreprise : dénomination, SIREN/SIRET, forme juridique, régimes fiscaux, adresse.",
      "Données de gestion saisies ou importées : clients, fournisseurs, factures, opérations bancaires, justificatifs, écritures.",
      "Données de connexion et de sécurité : adresse IP, navigateur, date des connexions, journal d'audit des actions sensibles.",
      "Messages adressés via le formulaire de contact ou le support.",
    ],
  },
  {
    title: "Finalités et bases légales",
    list: [
      "Fourniture du service et gestion du compte — exécution du contrat.",
      "Facturation des abonnements et obligations comptables — obligation légale.",
      "Sécurité, prévention de la fraude et journalisation — intérêt légitime.",
      "Réponse aux demandes de contact et de support — intérêt légitime ou mesures précontractuelles.",
    ],
  },
  {
    title: "Destinataires et sous-traitants",
    paragraphs: [
      "Les données sont accessibles aux seules personnes habilitées de l'éditeur, dans la limite de leurs attributions. L'accès du support aux données financières d'une entreprise est exceptionnel, motivé, limité dans le temps et journalisé.",
      "Nous faisons appel à des sous-traitants pour l'hébergement, l'envoi des e-mails transactionnels, le stockage des documents et le paiement des abonnements. La liste à jour est communiquée sur demande. Aucune donnée n'est vendue à des tiers.",
    ],
  },
  {
    title: "Durées de conservation",
    list: [
      "Compte utilisateur : pendant la durée de la relation contractuelle, puis suppression ou anonymisation après le délai de réversibilité.",
      "Pièces et écritures comptables : dix ans à compter de la clôture de l'exercice, conformément au Code de commerce.",
      "Journaux de connexion et d'audit : douze mois, sauf obligation légale contraire.",
      "Demandes de contact : trois ans à compter du dernier échange.",
    ],
  },
  {
    title: "Sécurité",
    list: [
      "Chiffrement des échanges (HTTPS) et des secrets sensibles au repos.",
      "Double authentification disponible pour tous les comptes.",
      "Cloisonnement strict des données de chaque entreprise.",
      "Sessions révocables, limitation des tentatives de connexion, sauvegardes chiffrées.",
    ],
  },
  {
    title: "Vos droits",
    paragraphs: [
      "Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données. Vous pouvez exporter vos données personnelles depuis votre compte (rubrique « Compte et sécurité »).",
      `Pour exercer vos droits, écrivez à ${legal.dpoEmail}. Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr).`,
      "Certaines données ne peuvent pas être effacées avant l'expiration des durées de conservation légales, notamment les pièces comptables.",
    ],
  },
  {
    title: "Cookies",
    paragraphs: [
      "Le site n'utilise que des cookies strictement nécessaires : un cookie de session sécurisé (httpOnly) pour vous maintenir connecté, et la mémorisation locale de votre préférence de thème. Aucun cookie publicitaire ni traceur tiers n'est déposé.",
    ],
  },
  {
    title: "Transferts hors Union européenne",
    paragraphs: [
      "Les données sont hébergées dans l'Union européenne. Si un sous-traitant devait traiter des données en dehors de l'Union, ce transfert serait encadré par des garanties appropriées, telles que les clauses contractuelles types de la Commission européenne.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Politique de confidentialité"
      description="Quelles données nous traitons, pourquoi, pendant combien de temps, et comment exercer vos droits."
      updatedAt="13 novembre 2026"
      sections={sections}
    />
  );
}
