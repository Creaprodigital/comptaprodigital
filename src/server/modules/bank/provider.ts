import type { BankConnectionStatus } from "@prisma/client";
import type { IsoDate } from "@/lib/dates";
import { env } from "@/server/env";
import { BridgeProvider } from "./bridge";

/**
 * Interface d'intégration avec un prestataire bancaire réglementé (agrégateur de
 * comptes agréé au titre de la DSP2).
 *
 * Principes, à respecter par toute implémentation :
 *  - la plateforme ne demande, ne voit et ne conserve jamais les identifiants de
 *    connexion bancaire : l'utilisateur s'authentifie chez le prestataire, sur
 *    son propre parcours (redirection), et consent explicitement au partage ;
 *  - seules sont conservées des références opaques : l'utilisateur et la connexion
 *    chez le prestataire (`bank_connections`), le compte (`bank_accounts.providerAccountRef`) ;
 *  - les opérations récupérées passent par la même détection des doublons et les
 *    mêmes règles de catégorisation que les imports de relevés ; aucun rapprochement
 *    automatique sans validation.
 *
 * Prestataire raccordé : Bridge (API v3), activé par BRIDGE_CLIENT_ID et BRIDGE_CLIENT_SECRET.
 */

export type ProviderItem = {
  ref: string;
  status: BankConnectionStatus;
  statusCode: number;
  statusInfo: string | null;
  statusDescription: string | null;
  authenticationExpiresAt: Date | null;
};

export type ProviderAccount = {
  ref: string;
  itemRef: string;
  name: string;
  type: string;
  iban: string | null;
  currency: string;
  /** Solde au format décimal (« 1489.54 »). */
  balance: string | null;
  /** L'utilisateur a autorisé l'accès aux données du compte. */
  enabled: boolean;
};

export type ProviderTransaction = {
  ref: string;
  accountRef: string;
  date: IsoDate;
  valueDate?: IsoDate;
  label: string;
  rawLabel: string;
  /** Montant signé au format décimal : positif = encaissement, négatif = décaissement. */
  amount: string;
  currency: string;
  /** Horodatage de dernière modification chez le prestataire (curseur de synchronisation). */
  updatedAt: string;
  deleted: boolean;
  /** Opération à venir, sans effet sur le solde. */
  future: boolean;
};

export interface BankDataProvider {
  /** Identifiant technique du prestataire. */
  readonly key: string;
  /** Nom affiché. */
  readonly label: string;
  /** Crée (ou retrouve) l'utilisateur du prestataire associé à l'entreprise ; retourne sa référence. */
  ensureUser(companyId: string, knownUserRef: string | null): Promise<string>;
  /** URL du parcours de consentement hébergé par le prestataire (nouvelle connexion, ou gestion d'une connexion existante). */
  createConnectSession(input: { userRef: string; userEmail: string; callbackUrl: string; context: string; itemRef?: string }): Promise<{ redirectUrl: string }>;
  getItem(userRef: string, itemRef: string): Promise<ProviderItem | null>;
  listAccounts(userRef: string, itemRef: string): Promise<ProviderAccount[]>;
  /** Opérations d'un compte modifiées depuis le curseur (toutes si `since` est nul). */
  listTransactions(userRef: string, accountRef: string, since: string | null): Promise<ProviderTransaction[]>;
  /** Révoque une connexion chez le prestataire. */
  deleteItem(userRef: string, itemRef: string): Promise<void>;
  /** Supprime l'utilisateur et toutes ses connexions chez le prestataire. */
  deleteUser(userRef: string): Promise<void>;
}

let cached: { key: string; provider: BankDataProvider } | null = null;

export function getBankDataProvider(): BankDataProvider | null {
  const config = env();
  if (!config.BRIDGE_CLIENT_ID || !config.BRIDGE_CLIENT_SECRET) return null;
  const key = `${config.BRIDGE_API_BASE ?? ""}|${config.BRIDGE_CLIENT_ID}`;
  if (cached?.key !== key) {
    cached = { key, provider: new BridgeProvider({ clientId: config.BRIDGE_CLIENT_ID, clientSecret: config.BRIDGE_CLIENT_SECRET, baseUrl: config.BRIDGE_API_BASE ?? "https://api.bridgeapi.io" }) };
  }
  return cached.provider;
}
