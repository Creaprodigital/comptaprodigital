import {
  BanknoteIcon,
  BarChart3Icon,
  BookOpenCheckIcon,
  BotIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderLockIcon,
  LandmarkIcon,
  PercentIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

/** Contenus du site vitrine. Textes originaux — aucune reprise d'un site tiers. */

export const mainNav = [
  { label: "Fonctionnalités", href: "/fonctionnalites" },
  { label: "Facturation", href: "/facturation" },
  { label: "Comptabilité", href: "/comptabilite" },
  { label: "Banque", href: "/synchronisation-bancaire" },
  { label: "TVA", href: "/gestion-tva" },
  { label: "Tarifs", href: "/tarifs" },
] as const;

export const footerNav = [
  {
    title: "Produit",
    links: [
      { label: "Fonctionnalités", href: "/fonctionnalites" },
      { label: "Facturation", href: "/facturation" },
      { label: "Comptabilité", href: "/comptabilite" },
      { label: "Synchronisation bancaire", href: "/synchronisation-bancaire" },
      { label: "Gestion de la TVA", href: "/gestion-tva" },
      { label: "Tarifs", href: "/tarifs" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Micro-entrepreneur", href: "/solutions/micro-entrepreneur" },
      { label: "Entreprise individuelle", href: "/solutions/entreprise-individuelle" },
      { label: "EURL et SARL", href: "/solutions/eurl-sarl" },
      { label: "SASU et SAS", href: "/solutions/sasu-sas" },
      { label: "Toutes les solutions", href: "/solutions" },
    ],
  },
  {
    title: "Ressources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Questions fréquentes", href: "/faq" },
      { label: "Contact", href: "/contact" },
      { label: "Connexion", href: "/connexion" },
      { label: "Créer un compte", href: "/inscription" },
    ],
  },
  {
    title: "Informations légales",
    links: [
      { label: "Mentions légales", href: "/mentions-legales" },
      { label: "CGU et CGV", href: "/cgu-cgv" },
      { label: "Politique de confidentialité", href: "/confidentialite" },
    ],
  },
] as const;

export type Feature = { icon: LucideIcon; title: string; description: string; href?: string };

export const coreFeatures: Feature[] = [
  {
    icon: ReceiptTextIcon,
    title: "Facturation",
    description: "Devis, factures, acomptes et avoirs numérotés chronologiquement, avec suivi des règlements et relances.",
    href: "/facturation",
  },
  {
    icon: LandmarkIcon,
    title: "Banque",
    description: "Relevés importés, opérations catégorisées par des règles et rapprochées de vos factures et justificatifs.",
    href: "/synchronisation-bancaire",
  },
  {
    icon: BookOpenCheckIcon,
    title: "Comptabilité",
    description: "Journaux, grand livre et balance tenus en partie double, avec traçabilité de chaque écriture et export FEC.",
    href: "/comptabilite",
  },
  {
    icon: PercentIcon,
    title: "TVA",
    description: "TVA collectée et déductible suivies selon votre régime, déclarations préparées et échéances rappelées.",
    href: "/gestion-tva",
  },
  {
    icon: FolderLockIcon,
    title: "Documents",
    description: "Factures d'achat et reçus classés, rattachés aux opérations et conservés dans un espace sécurisé.",
  },
  {
    icon: BarChart3Icon,
    title: "Pilotage",
    description: "Chiffre d'affaires, dépenses, résultat estimé et trésorerie disponible, calculés à partir de vos données réelles.",
  },
];

export const extendedFeatures: Feature[] = [
  {
    icon: UsersIcon,
    title: "Travail à plusieurs",
    description: "Invitez vos collaborateurs et votre expert-comptable avec des rôles précis : administrateur, collaborateur, lecture seule.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Sécurité",
    description: "Double authentification, données cloisonnées par entreprise, connexions chiffrées et journal d'audit des actions sensibles.",
  },
  {
    icon: FileSpreadsheetIcon,
    title: "Exports",
    description: "Récupérez vos données à tout moment : exports CSV, fichier des écritures comptables et archives de documents.",
  },
  {
    icon: BotIcon,
    title: "Assistant",
    description: "Des suggestions de catégories et la détection des doublons ou des justificatifs manquants, toujours soumises à votre validation.",
  },
  {
    icon: FileTextIcon,
    title: "Facturation électronique",
    description: "Une architecture pensée pour les formats structurés et le raccordement à une plateforme agréée.",
  },
  {
    icon: BanknoteIcon,
    title: "Multi-entreprises",
    description: "Gérez plusieurs sociétés depuis un seul compte, avec des données strictement séparées.",
  },
];

export const automationBenefits = [
  {
    title: "Moins de saisie",
    description: "Les informations d'une facture alimentent directement le suivi des règlements, la TVA et les journaux.",
  },
  {
    title: "Moins d'oublis",
    description: "Factures en retard, opérations sans justificatif, échéances de TVA : les points d'attention remontent d'eux-mêmes.",
  },
  {
    title: "Des chiffres à jour",
    description: "Chaque indicateur est recalculé à partir de vos écritures : pas de tableur à maintenir en parallèle.",
  },
  {
    title: "Vous gardez la main",
    description: "Aucune écriture n'est validée et aucune déclaration n'est transmise sans votre accord explicite.",
  },
];

export const howItWorks = [
  {
    title: "Créez votre espace",
    description: "Inscrivez-vous, saisissez votre SIREN : les informations publiques de votre entreprise sont pré-remplies.",
  },
  {
    title: "Facturez et importez",
    description: "Émettez vos factures, importez vos relevés bancaires et déposez vos justificatifs au fil de l'eau.",
  },
  {
    title: "Pilotez et déclarez",
    description: "Suivez vos indicateurs, préparez votre TVA et transmettez des comptes propres à votre expert-comptable.",
  },
];

export type Faq = { question: string; answer: string; category: "Produit" | "Comptabilité et fiscalité" | "Abonnement" | "Sécurité et données" };

export const faqs: Faq[] = [
  {
    category: "Produit",
    question: "À qui s'adresse ComptaPro Digital ?",
    answer:
      "Aux indépendants, micro-entrepreneurs, TPE et PME françaises : micro-entreprise, entreprise individuelle, EURL, SARL, SASU ou SAS. Les fonctionnalités s'adaptent à votre régime : livre des recettes pour une micro-entreprise, comptabilité en partie double pour une société.",
  },
  {
    category: "Produit",
    question: "Puis-je gérer plusieurs entreprises avec un seul compte ?",
    answer:
      "Oui, avec la formule Business. Chaque entreprise dispose de ses propres données, de ses propres membres et de ses propres paramètres : rien n'est partagé entre deux entreprises.",
  },
  {
    category: "Produit",
    question: "Puis-je donner accès à mon expert-comptable ?",
    answer:
      "Oui. Vous l'invitez par e-mail avec le rôle « Expert-comptable externe » : il consulte vos données, saisit des écritures, prépare la TVA et réalise les exports, sans pouvoir modifier votre facturation ni gérer les accès.",
  },
  {
    category: "Comptabilité et fiscalité",
    question: "ComptaPro Digital remplace-t-il un expert-comptable ?",
    answer:
      "Non. ComptaPro Digital est un logiciel de gestion et de tenue comptable. Il ne fournit pas de prestation d'expertise comptable, de conseil fiscal ou d'attestation des comptes, activités réservées aux professionnels inscrits à l'Ordre des experts-comptables. Il facilite en revanche la collaboration avec le vôtre.",
  },
  {
    category: "Comptabilité et fiscalité",
    question: "Mes déclarations de TVA sont-elles envoyées automatiquement ?",
    answer:
      "Non. La plateforme calcule et prépare les montants de chaque période selon votre régime, puis vous les validez. Le dépôt s'effectue par vos soins sur votre espace professionnel impots.gouv.fr, ou par votre expert-comptable.",
  },
  {
    category: "Comptabilité et fiscalité",
    question: "Vos factures sont-elles conformes à la facturation électronique ?",
    answer:
      "Les factures comportent les mentions obligatoires et une numérotation chronologique continue. Un simple PDF ne suffit toutefois pas à satisfaire l'obligation de facturation électronique : celle-ci impose des formats structurés (Factur-X, UBL, CII) transmis par une plateforme agréée. Notre architecture est conçue pour ce raccordement, qui sera proposé dès son ouverture.",
  },
  {
    category: "Abonnement",
    question: "L'essai est-il vraiment gratuit ?",
    answer:
      "Oui. Vous créez votre compte sans carte bancaire et testez la formule de votre choix pendant la période d'essai indiquée sur la page Tarifs. À son terme, vous choisissez de vous abonner ou non.",
  },
  {
    category: "Abonnement",
    question: "Puis-je changer de formule ou résilier ?",
    answer:
      "Oui, à tout moment depuis votre espace. Le changement de formule s'applique immédiatement ; la résiliation prend effet à la fin de la période déjà réglée, et vos données restent exportables.",
  },
  {
    category: "Sécurité et données",
    question: "Comment mes données sont-elles protégées ?",
    answer:
      "Les échanges sont chiffrés (HTTPS), les mots de passe sont hachés avec Argon2id, la double authentification est disponible pour chaque compte et les données de chaque entreprise sont cloisonnées. Les actions sensibles sont consignées dans un journal d'audit.",
  },
  {
    category: "Sécurité et données",
    question: "Dois-je vous communiquer mes identifiants bancaires ?",
    answer:
      "Jamais. Vous importez vos relevés (CSV, OFX, CAMT) depuis votre banque. La synchronisation automatique passera par un prestataire agréé : vous vous authentifierez directement auprès de votre banque, et nous ne verrons ni ne stockerons vos identifiants.",
  },
  {
    category: "Sécurité et données",
    question: "Puis-je récupérer ou supprimer mes données ?",
    answer:
      "Oui. Vous pouvez exporter vos données personnelles depuis votre compte et vos données comptables depuis chaque entreprise. Les demandes d'effacement sont traitées conformément au RGPD, dans la limite des durées de conservation légales applicables aux pièces comptables.",
  },
];

export type Solution = {
  slug: string;
  name: string;
  audience: string;
  headline: string;
  summary: string;
  needs: string[];
  features: string[];
  note: string;
  recommendedPlan: "STARTER" | "PRO" | "BUSINESS";
};

export const solutions: Solution[] = [
  {
    slug: "micro-entrepreneur",
    name: "Micro-entrepreneur",
    audience: "Auto-entrepreneurs et micro-entreprises",
    headline: "Facturez en règle et suivez vos encaissements sans vous compliquer la vie",
    summary:
      "En micro-entreprise, vos obligations sont allégées mais bien réelles : factures conformes, livre des recettes et suivi des seuils de chiffre d'affaires.",
    needs: [
      "Émettre des factures avec la mention de franchise en base de TVA",
      "Tenir un livre des recettes chronologique",
      "Connaître à tout moment son chiffre d'affaires encaissé",
    ],
    features: [
      "Devis et factures aux mentions obligatoires",
      "Livre des recettes alimenté par vos encaissements",
      "Tableau de bord du chiffre d'affaires mensuel et annuel",
      "Rappels des factures en retard",
    ],
    note: "Les seuils de chiffre d'affaires et de franchise de TVA évoluent : vérifiez les montants en vigueur sur les sites officiels.",
    recommendedPlan: "STARTER",
  },
  {
    slug: "entreprise-individuelle",
    name: "Entreprise individuelle",
    audience: "EI au régime réel ou en déclaration contrôlée",
    headline: "Une gestion claire entre recettes, dépenses et TVA",
    summary:
      "Au régime réel, vous devez suivre vos charges, votre TVA et produire des comptes annuels. La plateforme structure ce suivi dès la première facture.",
    needs: [
      "Distinguer dépenses professionnelles et justificatifs",
      "Suivre la TVA collectée et déductible",
      "Préparer les éléments de la liasse avec son expert-comptable",
    ],
    features: [
      "Facturation complète et suivi des règlements",
      "Import des relevés et catégorisation des opérations",
      "Suivi de la TVA selon votre régime",
      "Classement des justificatifs par opération",
    ],
    note: "Le choix du régime d'imposition a des conséquences fiscales et sociales : faites-le valider par un professionnel.",
    recommendedPlan: "PRO",
  },
  {
    slug: "eurl-sarl",
    name: "EURL et SARL",
    audience: "Sociétés à responsabilité limitée",
    headline: "Une comptabilité d'engagement tenue au quotidien",
    summary:
      "EURL et SARL tiennent une comptabilité complète en partie double. Chaque facture, achat et mouvement bancaire alimente vos journaux.",
    needs: [
      "Tenir les journaux de ventes, d'achats et de banque",
      "Rapprocher la banque et suivre les comptes clients et fournisseurs",
      "Clôturer l'exercice avec des écritures traçables",
    ],
    features: [
      "Plan comptable général configurable",
      "Grand livre, balance et journaux",
      "Verrouillage des périodes et clôture d'exercice",
      "Export du fichier des écritures comptables (FEC)",
    ],
    note: "La rémunération du gérant et le régime fiscal de la société relèvent d'un conseil personnalisé.",
    recommendedPlan: "PRO",
  },
  {
    slug: "sasu-sas",
    name: "SASU et SAS",
    audience: "Sociétés par actions simplifiées",
    headline: "Pilotez votre société et partagez l'information avec vos associés",
    summary:
      "En SASU ou en SAS, la qualité du suivi financier conditionne vos décisions et vos relations avec associés, banques et investisseurs.",
    needs: [
      "Disposer d'indicateurs fiables de résultat et de trésorerie",
      "Donner des accès différenciés à l'équipe et au cabinet comptable",
      "Gérer plusieurs entités le cas échéant",
    ],
    features: [
      "Tableau de bord financier et alertes d'échéances",
      "Rôles et permissions par collaborateur",
      "Comptabilité complète et suivi de la TVA",
      "Multi-entreprises avec données cloisonnées",
    ],
    note: "Les obligations d'approbation des comptes et de dépôt au greffe restent de la responsabilité des dirigeants.",
    recommendedPlan: "BUSINESS",
  },
];

export const comparisonRows: Array<{ label: string; values: [boolean | string, boolean | string, boolean | string] }> = [
  { label: "Devis, factures et avoirs", values: [true, true, true] },
  { label: "Tableau de bord", values: [true, true, true] },
  { label: "Gestion des clients", values: [true, true, true] },
  { label: "Factures d'acompte et factures récurrentes", values: [false, true, true] },
  { label: "Import de relevés bancaires", values: [false, true, true] },
  { label: "Comptabilité et journaux", values: [false, true, true] },
  { label: "Suivi et préparation de la TVA", values: [false, true, true] },
  { label: "Gestion documentaire", values: [false, true, true] },
  { label: "Accès expert-comptable", values: [false, true, true] },
  { label: "Entreprises", values: ["1", "1", "Jusqu'à 10"] },
  { label: "Utilisateurs par entreprise", values: ["1", "2", "Illimité"] },
  { label: "Automatisations avancées", values: [false, false, true] },
  { label: "Exports comptables (FEC)", values: [false, false, true] },
  { label: "Support prioritaire", values: [false, false, true] },
];
