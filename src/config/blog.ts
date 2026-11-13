/**
 * Articles du blog. Contenu éditorial versionné avec le code (pas de CMS à ce stade).
 * Les informations réglementaires sont générales : chaque article renvoie aux sources officielles.
 */

export type BlogSection = { heading: string; paragraphs?: string[]; list?: string[] };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  sections: BlogSection[];
  sources: Array<{ label: string; url: string }>;
};

export const blogPosts: BlogPost[] = [
  {
    slug: "facturation-electronique-tpe-pme",
    title: "Facturation électronique : ce que les TPE et PME doivent préparer",
    description:
      "Calendrier, formats structurés, plateformes agréées : l'essentiel de la réforme de la facturation électronique pour les petites entreprises.",
    category: "Facturation",
    publishedAt: "2026-10-06",
    readingMinutes: 5,
    sections: [
      {
        heading: "Une obligation qui concerne toutes les entreprises assujetties à la TVA",
        paragraphs: [
          "La réforme généralise la facture électronique pour les échanges entre entreprises assujetties à la TVA établies en France. Elle s'accompagne d'une obligation de transmission de certaines données à l'administration (e-reporting) pour les opérations qui n'entrent pas dans ce cadre, comme les ventes aux particuliers ou à l'international.",
          "Le calendrier est progressif. Depuis le 1er septembre 2026, toutes les entreprises doivent être en mesure de recevoir des factures électroniques, et les grandes entreprises et entreprises de taille intermédiaire doivent en émettre. L'obligation d'émission s'étend aux PME et aux micro-entreprises à compter du 1er septembre 2027.",
        ],
      },
      {
        heading: "Un PDF envoyé par e-mail n'est pas une facture électronique",
        paragraphs: [
          "C'est le point le plus souvent mal compris. Au sens de la réforme, une facture électronique est émise, transmise et reçue dans un format structuré, lisible par un logiciel : Factur-X (un PDF auquel est attaché un fichier de données), UBL ou CII.",
          "Elle circule par l'intermédiaire de plateformes agréées par l'administration, qui contrôlent les factures, les acheminent au destinataire et transmettent les données requises au fisc. Un PDF simple, même signé, ne répond donc pas à l'obligation.",
        ],
      },
      {
        heading: "Les nouvelles mentions à faire figurer",
        list: [
          "Le numéro SIREN du client",
          "L'adresse de livraison des biens lorsqu'elle diffère de l'adresse de facturation",
          "La nature de l'opération : livraison de biens, prestation de services ou opération mixte",
          "La mention du paiement de la TVA d'après les débits lorsque le prestataire a exercé cette option",
        ],
      },
      {
        heading: "Comment s'y préparer dès maintenant",
        list: [
          "Fiabiliser sa base clients : SIREN, adresses et numéros de TVA à jour",
          "Vérifier que son logiciel de facturation produit des données structurées et prévoit le raccordement à une plateforme agréée",
          "Choisir une plateforme agréée pour la réception, puis pour l'émission",
          "Revoir ses processus internes de validation et de suivi des statuts de factures",
        ],
      },
    ],
    sources: [
      { label: "impots.gouv.fr — rubrique « Facturation électronique »", url: "https://www.impots.gouv.fr" },
      { label: "entreprendre.service-public.fr — fiche « Facturation électronique »", url: "https://entreprendre.service-public.fr" },
    ],
  },
  {
    slug: "mentions-obligatoires-facture",
    title: "Les mentions obligatoires d'une facture, sans en oublier",
    description:
      "Numérotation, identité des parties, TVA, conditions de paiement : la liste commentée des mentions à faire figurer sur vos factures.",
    category: "Facturation",
    publishedAt: "2026-09-15",
    readingMinutes: 4,
    sections: [
      {
        heading: "Pourquoi c'est important",
        paragraphs: [
          "Une facture est à la fois une pièce comptable, un justificatif fiscal et une preuve commerciale. Une mention manquante ou inexacte expose à une amende par mention et par facture, et peut fragiliser le droit à déduction de la TVA de votre client.",
        ],
      },
      {
        heading: "Les mentions générales",
        list: [
          "Un numéro unique, issu d'une séquence chronologique continue, sans rupture ni doublon",
          "La date d'émission de la facture",
          "L'identité du vendeur : dénomination, forme juridique et capital pour une société, adresse du siège, numéro SIREN ou SIRET, mention du RCS ou du répertoire des métiers",
          "L'identité de l'acheteur : nom ou dénomination, adresse, et son numéro SIREN",
          "Le numéro de TVA intracommunautaire du vendeur et, selon les cas, de l'acheteur",
          "La date de la vente ou de la prestation",
          "Pour chaque ligne : désignation précise, quantité, prix unitaire hors taxes et taux de TVA",
          "Les réductions de prix acquises à la date de l'opération",
          "Le total hors taxes, le montant de TVA par taux et le total toutes taxes comprises",
        ],
      },
      {
        heading: "Les conditions de règlement",
        list: [
          "La date à laquelle le paiement doit intervenir",
          "Les conditions d'escompte en cas de paiement anticipé, ou la mention de leur absence",
          "Le taux des pénalités de retard",
          "L'indemnité forfaitaire de 40 € pour frais de recouvrement, due par les clients professionnels",
        ],
      },
      {
        heading: "Les mentions particulières",
        paragraphs: [
          "Certaines situations appellent une mention spécifique : « TVA non applicable, art. 293 B du CGI » pour les entreprises en franchise en base, « Autoliquidation » lorsque la TVA est due par le client, ou encore la référence à l'adhésion à un organisme de gestion agréé.",
          "Une fois émise, une facture ne se modifie pas et ne se supprime pas : une erreur se corrige par une facture rectificative ou par un avoir, qui fait référence à la facture d'origine.",
        ],
      },
    ],
    sources: [
      { label: "entreprendre.service-public.fr — fiche « Mentions obligatoires d'une facture »", url: "https://entreprendre.service-public.fr" },
      { label: "economie.gouv.fr — DGCCRF, fiche « Facturation entre professionnels »", url: "https://www.economie.gouv.fr" },
    ],
  },
  {
    slug: "tva-debits-ou-encaissements",
    title: "TVA sur les débits ou sur les encaissements : comprendre l'exigibilité",
    description:
      "À quel moment la TVA devient-elle due au Trésor ? Les règles pour les ventes de biens, les prestations de services et l'option pour les débits.",
    category: "TVA",
    publishedAt: "2026-08-25",
    readingMinutes: 4,
    sections: [
      {
        heading: "Fait générateur et exigibilité : deux notions distinctes",
        paragraphs: [
          "Le fait générateur est l'événement qui fait naître la dette de TVA : la livraison du bien ou l'exécution de la prestation. L'exigibilité est le moment où le Trésor peut en réclamer le paiement. C'est elle qui détermine la période sur laquelle vous déclarez la TVA collectée, et celle sur laquelle votre client peut la déduire.",
        ],
      },
      {
        heading: "Livraisons de biens : à la livraison",
        paragraphs: [
          "Pour une vente de biens, la TVA est exigible lors de la livraison, c'est-à-dire en pratique à la date de la facture. Lorsqu'un acompte est encaissé avant la livraison, la TVA devient exigible dès cet encaissement, à hauteur du montant perçu.",
        ],
      },
      {
        heading: "Prestations de services : à l'encaissement",
        paragraphs: [
          "Pour une prestation de services, la TVA est exigible lors de l'encaissement du prix ou des acomptes. Une facture émise en mars et payée en mai génère donc une TVA à déclarer au titre de mai.",
          "Cette règle protège la trésorerie du prestataire, mais elle suppose de suivre précisément les dates de règlement, y compris les paiements partiels.",
        ],
      },
      {
        heading: "L'option pour les débits",
        paragraphs: [
          "Un prestataire de services peut choisir d'acquitter la TVA d'après les débits : la taxe devient alors exigible dès la facturation, sans attendre le paiement. L'option simplifie le suivi lorsque l'entreprise vend à la fois des biens et des services, mais elle conduit à avancer la TVA sur les factures non encore réglées.",
          "Lorsque cette option est exercée, elle doit être mentionnée sur les factures, afin que le client sache qu'il peut déduire la TVA sans attendre son paiement.",
        ],
      },
      {
        heading: "Ce que cela change dans votre outil de gestion",
        list: [
          "Chaque facture doit porter son régime d'exigibilité",
          "La TVA collectée d'une période se calcule sur les factures émises (débits) ou sur les règlements reçus (encaissements)",
          "Un règlement partiel ne rend exigible qu'une fraction proportionnelle de la TVA de la facture",
        ],
      },
    ],
    sources: [
      { label: "entreprendre.service-public.fr — fiche « Exigibilité de la TVA »", url: "https://entreprendre.service-public.fr" },
      { label: "bofip.impots.gouv.fr — TVA, fait générateur et exigibilité", url: "https://bofip.impots.gouv.fr" },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}
