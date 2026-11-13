/**
 * Référentiel des formes juridiques et régimes fiscaux proposés.
 * Module partagé client/serveur : uniquement des constantes.
 *
 * ⚠️ Les combinaisons autorisées ci-dessous couvrent les cas courants et doivent
 * être revues par un professionnel du chiffre avant commercialisation.
 */

export const LEGAL_FORMS = ["MICRO_ENTREPRISE", "EI", "EURL", "SARL", "SASU", "SAS", "SA", "SCI", "ASSOCIATION", "OTHER"] as const;
export type LegalFormKey = (typeof LEGAL_FORMS)[number];

export const TAX_REGIMES = [
  "MICRO_BIC",
  "MICRO_BNC",
  "BNC_DECLARATION_CONTROLEE",
  "IR_REEL_SIMPLIFIE",
  "IR_REEL_NORMAL",
  "IS_REEL_SIMPLIFIE",
  "IS_REEL_NORMAL",
] as const;
export type TaxRegimeKey = (typeof TAX_REGIMES)[number];

export const VAT_REGIMES = ["FRANCHISE", "REEL_SIMPLIFIE", "REEL_NORMAL_MENSUEL", "REEL_NORMAL_TRIMESTRIEL"] as const;
export type VatRegimeKey = (typeof VAT_REGIMES)[number];

export const VAT_EXIGIBILITIES = ["ENCAISSEMENTS", "DEBITS"] as const;
export type VatExigibilityKey = (typeof VAT_EXIGIBILITIES)[number];

export const LEGAL_FORM_LABELS: Record<LegalFormKey, string> = {
  MICRO_ENTREPRISE: "Micro-entreprise (auto-entrepreneur)",
  EI: "Entreprise individuelle (EI)",
  EURL: "EURL",
  SARL: "SARL",
  SASU: "SASU",
  SAS: "SAS",
  SA: "SA",
  SCI: "SCI",
  ASSOCIATION: "Association",
  OTHER: "Autre forme juridique",
};

export const TAX_REGIME_LABELS: Record<TaxRegimeKey, string> = {
  MICRO_BIC: "Micro-BIC",
  MICRO_BNC: "Micro-BNC",
  BNC_DECLARATION_CONTROLEE: "BNC — déclaration contrôlée",
  IR_REEL_SIMPLIFIE: "Impôt sur le revenu — réel simplifié",
  IR_REEL_NORMAL: "Impôt sur le revenu — réel normal",
  IS_REEL_SIMPLIFIE: "Impôt sur les sociétés — réel simplifié",
  IS_REEL_NORMAL: "Impôt sur les sociétés — réel normal",
};

export const VAT_REGIME_LABELS: Record<VatRegimeKey, string> = {
  FRANCHISE: "Franchise en base (pas de TVA facturée)",
  REEL_SIMPLIFIE: "Réel simplifié (déclaration annuelle CA12)",
  REEL_NORMAL_MENSUEL: "Réel normal — déclaration mensuelle (CA3)",
  REEL_NORMAL_TRIMESTRIEL: "Réel normal — déclaration trimestrielle (CA3)",
};

export const VAT_EXIGIBILITY_LABELS: Record<VatExigibilityKey, string> = {
  ENCAISSEMENTS: "Sur les encaissements (prestations de services)",
  DEBITS: "Sur les débits (ventes de biens ou option)",
};

const ALL_REAL: TaxRegimeKey[] = ["IR_REEL_SIMPLIFIE", "IR_REEL_NORMAL", "IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL"];

export const TAX_REGIMES_BY_LEGAL_FORM: Record<LegalFormKey, TaxRegimeKey[]> = {
  MICRO_ENTREPRISE: ["MICRO_BIC", "MICRO_BNC"],
  EI: ["MICRO_BIC", "MICRO_BNC", "BNC_DECLARATION_CONTROLEE", ...ALL_REAL],
  EURL: ["IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL", "IR_REEL_SIMPLIFIE", "IR_REEL_NORMAL", "BNC_DECLARATION_CONTROLEE", "MICRO_BIC", "MICRO_BNC"],
  SARL: ["IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL", "IR_REEL_SIMPLIFIE", "IR_REEL_NORMAL"],
  SASU: ["IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL", "IR_REEL_SIMPLIFIE", "IR_REEL_NORMAL"],
  SAS: ["IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL", "IR_REEL_SIMPLIFIE", "IR_REEL_NORMAL"],
  SA: ["IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL"],
  SCI: ["IR_REEL_SIMPLIFIE", "IS_REEL_SIMPLIFIE", "IS_REEL_NORMAL"],
  ASSOCIATION: [...ALL_REAL],
  OTHER: [...TAX_REGIMES],
};

export function isTaxRegimeAllowed(legalForm: LegalFormKey, taxRegime: TaxRegimeKey): boolean {
  return TAX_REGIMES_BY_LEGAL_FORM[legalForm].includes(taxRegime);
}

export function isMicroRegime(taxRegime: TaxRegimeKey): boolean {
  return taxRegime === "MICRO_BIC" || taxRegime === "MICRO_BNC";
}

/** Régimes proposés par défaut à la sélection d'une forme juridique. */
export function defaultRegimesFor(legalForm: LegalFormKey): { taxRegime: TaxRegimeKey; vatRegime: VatRegimeKey } {
  const taxRegime = TAX_REGIMES_BY_LEGAL_FORM[legalForm][0];
  return { taxRegime, vatRegime: isMicroRegime(taxRegime) ? "FRANCHISE" : "REEL_SIMPLIFIE" };
}

/** Mode de tenue : livre des recettes pour les micro-entreprises, partie double sinon. */
export function accountingModeFor(taxRegime: TaxRegimeKey): "CASH_BOOK" | "DOUBLE_ENTRY" {
  return isMicroRegime(taxRegime) ? "CASH_BOOK" : "DOUBLE_ENTRY";
}
