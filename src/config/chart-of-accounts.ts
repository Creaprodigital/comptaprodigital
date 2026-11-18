/**
 * Plan comptable de référence proposé à chaque entreprise : une sélection des
 * comptes du plan comptable général (PCG) utiles à une TPE ou une PME.
 * Chaque entreprise peut ajouter ses propres comptes (sous-comptes, comptes de
 * tiers…) ; les comptes de référence ne peuvent pas être supprimés.
 *
 * Les comptes 445810 et 445820 sont des subdivisions du compte 4458 « Taxes sur
 * le chiffre d'affaires à régulariser ou en attente », utilisées pour la TVA
 * exigible à l'encaissement (ventes) ou au paiement (achats de services).
 */

export type AccountTypeKey = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type ReferenceAccount = { number: string; label: string; type: AccountTypeKey };

export const REFERENCE_ACCOUNTS: ReferenceAccount[] = [
  // Classe 1 — Capitaux
  { number: "101300", label: "Capital souscrit, appelé, versé", type: "EQUITY" },
  { number: "106100", label: "Réserve légale", type: "EQUITY" },
  { number: "108000", label: "Compte de l'exploitant", type: "EQUITY" },
  { number: "110000", label: "Report à nouveau (solde créditeur)", type: "EQUITY" },
  { number: "119000", label: "Report à nouveau (solde débiteur)", type: "EQUITY" },
  { number: "120000", label: "Résultat de l'exercice (bénéfice)", type: "EQUITY" },
  { number: "129000", label: "Résultat de l'exercice (perte)", type: "EQUITY" },
  { number: "164000", label: "Emprunts auprès des établissements de crédit", type: "LIABILITY" },
  // Classe 2 — Immobilisations
  { number: "201000", label: "Frais d'établissement", type: "ASSET" },
  { number: "205000", label: "Concessions, brevets, licences, logiciels", type: "ASSET" },
  { number: "211000", label: "Terrains", type: "ASSET" },
  { number: "213100", label: "Bâtiments", type: "ASSET" },
  { number: "215400", label: "Matériel industriel", type: "ASSET" },
  { number: "218100", label: "Installations générales, agencements", type: "ASSET" },
  { number: "218200", label: "Matériel de transport", type: "ASSET" },
  { number: "218300", label: "Matériel de bureau et matériel informatique", type: "ASSET" },
  { number: "218400", label: "Mobilier", type: "ASSET" },
  { number: "275000", label: "Dépôts et cautionnements versés", type: "ASSET" },
  { number: "280500", label: "Amortissements des concessions, logiciels", type: "ASSET" },
  { number: "281310", label: "Amortissements des bâtiments", type: "ASSET" },
  { number: "281540", label: "Amortissements du matériel industriel", type: "ASSET" },
  { number: "281810", label: "Amortissements des installations générales", type: "ASSET" },
  { number: "281820", label: "Amortissements du matériel de transport", type: "ASSET" },
  { number: "281830", label: "Amortissements du matériel de bureau et informatique", type: "ASSET" },
  { number: "281840", label: "Amortissements du mobilier", type: "ASSET" },
  // Classe 3 — Stocks
  { number: "310000", label: "Stocks de matières premières", type: "ASSET" },
  { number: "370000", label: "Stocks de marchandises", type: "ASSET" },
  // Classe 4 — Tiers
  { number: "401000", label: "Fournisseurs", type: "LIABILITY" },
  { number: "404000", label: "Fournisseurs d'immobilisations", type: "LIABILITY" },
  { number: "408000", label: "Fournisseurs — factures non parvenues", type: "LIABILITY" },
  { number: "409100", label: "Fournisseurs — avances et acomptes versés", type: "ASSET" },
  { number: "411000", label: "Clients", type: "ASSET" },
  { number: "416000", label: "Clients douteux ou litigieux", type: "ASSET" },
  { number: "418000", label: "Clients — produits non encore facturés", type: "ASSET" },
  { number: "419100", label: "Clients — avances et acomptes reçus", type: "LIABILITY" },
  { number: "421000", label: "Personnel — rémunérations dues", type: "LIABILITY" },
  { number: "431000", label: "Sécurité sociale", type: "LIABILITY" },
  { number: "437000", label: "Autres organismes sociaux", type: "LIABILITY" },
  { number: "444000", label: "État — impôts sur les bénéfices", type: "LIABILITY" },
  { number: "445510", label: "TVA à décaisser", type: "LIABILITY" },
  { number: "445620", label: "TVA déductible sur immobilisations", type: "ASSET" },
  { number: "445660", label: "TVA déductible sur autres biens et services", type: "ASSET" },
  { number: "445670", label: "Crédit de TVA à reporter", type: "ASSET" },
  { number: "445710", label: "TVA collectée", type: "LIABILITY" },
  { number: "445810", label: "TVA collectée en attente d'encaissement", type: "LIABILITY" },
  { number: "445820", label: "TVA déductible en attente de paiement", type: "ASSET" },
  { number: "447000", label: "Autres impôts, taxes et versements assimilés", type: "LIABILITY" },
  { number: "455000", label: "Associés — comptes courants", type: "LIABILITY" },
  { number: "462000", label: "Créances sur cessions d'immobilisations", type: "ASSET" },
  { number: "467000", label: "Autres comptes débiteurs ou créditeurs", type: "ASSET" },
  { number: "471000", label: "Compte d'attente", type: "ASSET" },
  { number: "486000", label: "Charges constatées d'avance", type: "ASSET" },
  { number: "487000", label: "Produits constatés d'avance", type: "LIABILITY" },
  // Classe 5 — Financiers
  { number: "511000", label: "Valeurs à l'encaissement", type: "ASSET" },
  { number: "512000", label: "Banque", type: "ASSET" },
  { number: "530000", label: "Caisse", type: "ASSET" },
  { number: "580000", label: "Virements internes", type: "ASSET" },
  // Classe 6 — Charges
  { number: "601000", label: "Achats de matières premières", type: "EXPENSE" },
  { number: "606100", label: "Fournitures non stockables (eau, énergie)", type: "EXPENSE" },
  { number: "606300", label: "Fournitures d'entretien et de petit équipement", type: "EXPENSE" },
  { number: "606400", label: "Fournitures administratives", type: "EXPENSE" },
  { number: "607000", label: "Achats de marchandises", type: "EXPENSE" },
  { number: "611000", label: "Sous-traitance générale", type: "EXPENSE" },
  { number: "613200", label: "Locations immobilières", type: "EXPENSE" },
  { number: "613500", label: "Locations mobilières", type: "EXPENSE" },
  { number: "615000", label: "Entretien et réparations", type: "EXPENSE" },
  { number: "615600", label: "Maintenance", type: "EXPENSE" },
  { number: "616000", label: "Primes d'assurances", type: "EXPENSE" },
  { number: "618500", label: "Frais de colloques, séminaires, conférences", type: "EXPENSE" },
  { number: "622600", label: "Honoraires", type: "EXPENSE" },
  { number: "623000", label: "Publicité, publications, relations publiques", type: "EXPENSE" },
  { number: "625100", label: "Voyages et déplacements", type: "EXPENSE" },
  { number: "625700", label: "Réceptions", type: "EXPENSE" },
  { number: "626000", label: "Frais postaux et de télécommunications", type: "EXPENSE" },
  { number: "627000", label: "Services bancaires et assimilés", type: "EXPENSE" },
  { number: "635000", label: "Autres impôts, taxes et versements assimilés", type: "EXPENSE" },
  { number: "641000", label: "Rémunérations du personnel", type: "EXPENSE" },
  { number: "644000", label: "Rémunération du travail de l'exploitant", type: "EXPENSE" },
  { number: "645000", label: "Charges de sécurité sociale et de prévoyance", type: "EXPENSE" },
  { number: "646000", label: "Cotisations sociales personnelles de l'exploitant", type: "EXPENSE" },
  { number: "658000", label: "Charges diverses de gestion courante", type: "EXPENSE" },
  { number: "661100", label: "Intérêts des emprunts et dettes", type: "EXPENSE" },
  { number: "671000", label: "Charges exceptionnelles sur opérations de gestion", type: "EXPENSE" },
  { number: "675000", label: "Valeurs comptables des éléments d'actif cédés", type: "EXPENSE" },
  { number: "681100", label: "Dotations aux amortissements des immobilisations", type: "EXPENSE" },
  { number: "695000", label: "Impôts sur les bénéfices", type: "EXPENSE" },
  // Classe 7 — Produits
  { number: "701000", label: "Ventes de produits finis", type: "INCOME" },
  { number: "706000", label: "Prestations de services", type: "INCOME" },
  { number: "707000", label: "Ventes de marchandises", type: "INCOME" },
  { number: "708500", label: "Ports et frais accessoires facturés", type: "INCOME" },
  { number: "709000", label: "Rabais, remises et ristournes accordés", type: "INCOME" },
  { number: "740000", label: "Subventions d'exploitation", type: "INCOME" },
  { number: "758000", label: "Produits divers de gestion courante", type: "INCOME" },
  { number: "768000", label: "Autres produits financiers", type: "INCOME" },
  { number: "771000", label: "Produits exceptionnels sur opérations de gestion", type: "INCOME" },
  { number: "775000", label: "Produits des cessions d'éléments d'actif", type: "INCOME" },
  { number: "791000", label: "Transferts de charges", type: "INCOME" },
];

/** Comptes utilisés par les règles de comptabilisation automatique. */
export const ACCOUNTS = {
  customers: "411000",
  suppliers: "401000",
  customerDeposits: "419100",
  bank: "512000",
  cash: "530000",
  pendingCollection: "511000",
  suspense: "471000",
  vatCollected: "445710",
  vatCollectedPending: "445810",
  vatDeductible: "445660",
  vatDeductibleAssets: "445620",
  vatDeductiblePending: "445820",
  vatToPay: "445510",
  vatCredit: "445670",
  services: "706000",
  goods: "707000",
  discounts: "709000",
  profit: "120000",
  loss: "129000",
  depreciationExpense: "681100",
  disposedAssetValue: "675000",
  disposalProceeds: "775000",
  disposalReceivable: "462000",
} as const;

/** Nature d'un compte d'après sa classe, pour un compte créé par l'entreprise. */
export function accountTypeFor(number: string): AccountTypeKey {
  const head = number[0];
  if (head === "1") return number.startsWith("16") ? "LIABILITY" : "EQUITY";
  if (head === "2" || head === "3" || head === "5") return "ASSET";
  if (head === "6") return "EXPENSE";
  if (head === "7") return "INCOME";
  if (/^(40|42|43|44|45|487|419)/.test(number) && !/^(409|4456|4458[2-9]|445670)/.test(number)) return "LIABILITY";
  return "ASSET";
}

export const ACCOUNT_CLASS_LABELS: Record<string, string> = {
  "1": "Comptes de capitaux",
  "2": "Comptes d'immobilisations",
  "3": "Comptes de stocks et en-cours",
  "4": "Comptes de tiers",
  "5": "Comptes financiers",
  "6": "Comptes de charges",
  "7": "Comptes de produits",
};

/** Journaux créés pour chaque entreprise (un journal de banque est ajouté par compte bancaire). */
export const REFERENCE_JOURNALS = [
  { code: "VT", label: "Journal des ventes", type: "SALES" },
  { code: "AC", label: "Journal des achats", type: "PURCHASES" },
  { code: "OD", label: "Opérations diverses", type: "MISC" },
  { code: "AN", label: "À-nouveaux", type: "OPENING" },
  { code: "CA", label: "Caisse", type: "BANK" },
] as const;
