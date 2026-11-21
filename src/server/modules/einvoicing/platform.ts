import type { EInvoiceFormat } from "@prisma/client";
import { env } from "@/server/env";

/**
 * Interface d'intégration avec une plateforme agréée de facturation électronique (PA, ex-PDP).
 *
 * ComptaPro Digital se raccorde à une plateforme pour l'ensemble de ses entreprises : chaque entreprise y
 * est identifiée par son SIREN. Toute implémentation doit :
 *  - déposer le fichier tel qu'il a été émis (original archivé de la facture, Factur-X EN 16931) et
 *    retourner l'identifiant du dépôt — un dépôt rejoué avec la même clé d'idempotence ne crée pas de
 *    second dépôt ;
 *  - restituer les statuts du cycle de vie des factures émises et reçues, et les factures reçues ;
 *  - transmettre les statuts émis par l'entreprise (refus, litige, encaissement…) ;
 *  - authentifier ses appels entrants (webhooks) avant d'en extraire des données.
 *
 * Aucune plateforme n'est raccordée à ce jour : `getEInvoicePlatform()` retourne `null` et le module est
 * entièrement masqué dans l'interface. Une facture émise reste disponible au format Factur-X, que
 * l'entreprise peut transmettre par sa propre plateforme.
 */

export type LifecycleUpdate = {
  /** Identifiant du dépôt (facture émise) ou de la facture reçue chez la plateforme. */
  platformRef: string;
  direction: "OUTGOING" | "INCOMING";
  code: number;
  reason?: string;
  occurredAt: Date;
  source: "PLATFORM" | "BUYER" | "SELLER";
};

export type IncomingInvoiceFile = {
  platformRef: string;
  /** SIREN de l'entreprise destinataire. */
  recipientSiren: string;
  format: EInvoiceFormat;
  /** Données structurées (CII ou UBL). */
  xml: string;
  /** PDF lisible (Factur-X), lorsqu'il existe. */
  pdf?: Buffer;
  receivedAt: Date;
};

export interface EInvoicePlatform {
  readonly key: string;
  readonly label: string;
  submit(input: { idempotencyKey: string; senderSiren: string; recipientSiren: string; format: EInvoiceFormat; fileName: string; content: Buffer; mimeType: string }): Promise<{ platformRef: string }>;
  /** Statuts survenus depuis une date (toutes entreprises confondues). */
  listLifecycleUpdates(since: Date | null): Promise<LifecycleUpdate[]>;
  /** Factures reçues depuis une date (toutes entreprises confondues). */
  listIncoming(since: Date | null): Promise<IncomingInvoiceFile[]>;
  sendStatus(input: { platformRef: string; direction: "OUTGOING" | "INCOMING"; code: number; reason?: string }): Promise<void>;
  /** Authentifie un webhook ; `null` s'il n'est pas authentique. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<{ lifecycle: LifecycleUpdate[]; incomingAvailable: boolean } | null>;
}

let override: EInvoicePlatform | null | undefined;

export function getEInvoicePlatform(): EInvoicePlatform | null {
  if (override !== undefined) return override;
  // Aucune plateforme raccordée : le choix de la plateforme (et son contrat) reste à faire.
  return null;
}

/** Réservé aux tests : raccorde une plateforme simulée. */
export function setEInvoicePlatformForTests(platform: EInvoicePlatform | null | undefined) {
  if (env().NODE_ENV === "production") throw new Error("Plateforme simulée interdite en production");
  override = platform;
}
