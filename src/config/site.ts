/**
 * Identité du site. Les informations légales de l'éditeur sont lues depuis des
 * variables d'environnement publiques afin de ne pas figer de données dans le code.
 */
export const siteConfig = {
  name: "ComptaPro Digital",
  shortName: "ComptaPro",
  tagline: "La comptabilité en ligne des indépendants et des petites entreprises",
  description:
    "Facturation, banque, comptabilité et TVA réunies dans une seule plateforme en ligne, pensée pour les indépendants, TPE et PME françaises.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? "http://localhost:3000",
  locale: "fr_FR",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@comptaprodigital.fr",
  legal: {
    companyName: process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME ?? "[Raison sociale de l'éditeur à compléter]",
    legalForm: process.env.NEXT_PUBLIC_LEGAL_FORM ?? "[Forme juridique et capital social à compléter]",
    address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? "[Adresse du siège social à compléter]",
    siren: process.env.NEXT_PUBLIC_LEGAL_SIREN ?? "[Numéro SIREN à compléter]",
    rcs: process.env.NEXT_PUBLIC_LEGAL_RCS ?? "[Ville d'immatriculation au RCS à compléter]",
    vatNumber: process.env.NEXT_PUBLIC_LEGAL_VAT ?? "[Numéro de TVA intracommunautaire à compléter]",
    publicationDirector: process.env.NEXT_PUBLIC_LEGAL_DIRECTOR ?? "[Nom du directeur de la publication à compléter]",
    host: process.env.NEXT_PUBLIC_LEGAL_HOST ?? "Hostinger International Ltd, 61 Lordou Vironos Street, 6023 Larnaca, Chypre",
    dpoEmail: process.env.NEXT_PUBLIC_DPO_EMAIL ?? "rgpd@comptaprodigital.fr",
  },
} as const;
