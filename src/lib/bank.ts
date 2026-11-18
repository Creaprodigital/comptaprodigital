/** Constantes et libellés de la banque et des documents, partagés entre le serveur et l'interface. */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png";
export const STATEMENT_ACCEPT = ".csv,.txt,.ofx,.qfx,.xml,text/csv,application/xml,text/xml";

export const DOCUMENT_CATEGORIES = ["PURCHASE_INVOICE", "RECEIPT", "SALES_INVOICE", "BANK_STATEMENT", "TAX", "PAYROLL", "LEGAL", "OTHER"] as const;
export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategoryKey, string> = {
  PURCHASE_INVOICE: "Factures d'achat",
  RECEIPT: "Reçus et tickets",
  SALES_INVOICE: "Factures de vente",
  BANK_STATEMENT: "Relevés bancaires",
  TAX: "Fiscal",
  PAYROLL: "Social et paie",
  LEGAL: "Juridique",
  OTHER: "Autres",
};

export const CATEGORY_KINDS = ["EXPENSE", "INCOME", "PAYROLL", "TAX", "TRANSFER", "OTHER"] as const;
export type CategoryKindKey = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_KIND_LABELS: Record<CategoryKindKey, string> = {
  EXPENSE: "Charges",
  INCOME: "Produits",
  PAYROLL: "Personnel",
  TAX: "Impôts et taxes",
  TRANSFER: "Mouvements internes",
  OTHER: "Divers",
};

export const TRANSACTION_STATUS_LABELS = {
  TO_REVIEW: "À traiter",
  CATEGORIZED: "Catégorisée",
  RECONCILED: "Rapprochée",
} as const;
export type TransactionStatusKey = keyof typeof TRANSACTION_STATUS_LABELS;

export const RULE_MATCH_TYPES = ["CONTAINS", "STARTS_WITH", "EQUALS"] as const;
export const RULE_MATCH_LABELS: Record<(typeof RULE_MATCH_TYPES)[number], string> = {
  CONTAINS: "contient",
  STARTS_WITH: "commence par",
  EQUALS: "est exactement",
};

export const STATEMENT_FORMAT_LABELS = { CSV: "CSV", OFX: "OFX", CAMT053: "camt.053 (ISO 20022)" } as const;

/** Taux de TVA proposés pour ventiler une opération bancaire. */
export const BANK_VAT_RATES = ["20", "10", "5.5", "2.1", "0"] as const;

/** Un décaissement appelle un justificatif tant qu'il n'est pas classé hors charges (impôt, virement interne…). */
export function requiresReceipt(transaction: { amount: string; documentCount: number; category: { kind: string } | null; purchase?: { id: string } | null }): boolean {
  if (!transaction.amount.startsWith("-") || transaction.documentCount > 0 || transaction.purchase) return false;
  return transaction.category === null || transaction.category.kind === "EXPENSE" || transaction.category.kind === "PAYROLL";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
