import type { EInvoiceStatus } from "@prisma/client";

/**
 * Statuts du cycle de vie des factures électroniques (réforme de la facturation électronique entre
 * entreprises assujetties, spécifications externes de l'administration fiscale). Quatre statuts sont
 * obligatoires : Déposée (200), Rejetée (213), Refusée (210) et Encaissée (212) ; les autres sont
 * facultatifs et transmis lorsque la plateforme ou le client les produisent.
 */
export const LIFECYCLE: Record<number, { label: string; summary: Exclude<EInvoiceStatus, "NOT_APPLICABLE" | "PENDING">; mandatory?: boolean }> = {
  200: { label: "Déposée", summary: "DEPOSITED", mandatory: true },
  201: { label: "Émise par la plateforme", summary: "DEPOSITED" },
  202: { label: "Reçue par la plateforme", summary: "DEPOSITED" },
  203: { label: "Mise à disposition", summary: "DEPOSITED" },
  204: { label: "Prise en charge", summary: "ACCEPTED" },
  205: { label: "Approuvée", summary: "ACCEPTED" },
  206: { label: "Approuvée partiellement", summary: "ACCEPTED" },
  207: { label: "En litige", summary: "DISPUTED" },
  208: { label: "Suspendue", summary: "DISPUTED" },
  209: { label: "Complétée", summary: "ACCEPTED" },
  210: { label: "Refusée", summary: "REFUSED", mandatory: true },
  211: { label: "Paiement transmis", summary: "ACCEPTED" },
  212: { label: "Encaissée", summary: "PAID", mandatory: true },
  213: { label: "Rejetée", summary: "REJECTED", mandatory: true },
};

export const isLifecycleCode = (code: number): boolean => Object.hasOwn(LIFECYCLE, code);

/** Statuts que le destinataire d'une facture peut émettre (refus et litige motivés). */
export const RECIPIENT_STATUSES = [204, 205, 206, 207, 208, 210, 211] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
export const REASON_REQUIRED = new Set<number>([207, 208, 210]);

/** Fin de parcours : plus aucun statut attendu de la plateforme. */
export const TERMINAL_CODES = new Set<number>([210, 212, 213]);

export const lifecycleLabel = (code: number): string => LIFECYCLE[code]?.label ?? `Statut ${code}`;

/** Situation résumée : le statut le plus récent (à date égale, le code le plus avancé). */
export function summarize(events: Array<{ code: number; occurredAt: Date }>): EInvoiceStatus | null {
  const known = events.filter((e) => isLifecycleCode(e.code));
  if (known.length === 0) return null;
  const latest = known.reduce((a, b) => (b.occurredAt.getTime() > a.occurredAt.getTime() || (b.occurredAt.getTime() === a.occurredAt.getTime() && b.code > a.code) ? b : a));
  return LIFECYCLE[latest.code].summary;
}
