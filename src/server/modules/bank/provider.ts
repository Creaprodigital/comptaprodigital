import type { IsoDate } from "@/lib/dates";

/**
 * Interface d'intégration avec un prestataire bancaire réglementé (agrégateur de
 * comptes agréé au titre de la DSP2).
 *
 * Principes, à respecter par toute implémentation :
 *  - la plateforme ne demande, ne voit et ne conserve jamais les identifiants de
 *    connexion bancaire : l'utilisateur s'authentifie chez le prestataire, sur
 *    son propre parcours (redirection), et consent explicitement au partage ;
 *  - seuls sont conservés une référence opaque de la connexion et l'identifiant
 *    du compte chez le prestataire (`bank_accounts.providerAccountRef`) ;
 *  - les opérations récupérées entrent par le même chemin que les imports de
 *    relevés : détection des doublons par référence bancaire, règles de
 *    catégorisation, aucun rapprochement automatique sans validation.
 *
 * Aucun prestataire n'est raccordé à ce jour : `getBankDataProvider()` retourne
 * `null` et l'interface ne propose que l'import de relevés.
 */

export type ProviderAccount = { ref: string; name: string; ibanLast4: string | null; currency: string; balance: string | null };

export type ProviderTransaction = { externalId: string; date: IsoDate; valueDate?: IsoDate; label: string; amount: string };

export interface BankDataProvider {
  /** Identifiant technique du prestataire (ex. nom commercial en minuscules). */
  readonly key: string;
  /** URL du parcours de consentement hébergé par le prestataire. */
  createConnectSession(input: { companyId: string; userId: string; returnUrl: string }): Promise<{ redirectUrl: string }>;
  /** Appelé au retour du parcours : échange le code contre une référence de connexion. */
  completeConnectSession(input: { companyId: string; callbackParams: Record<string, string> }): Promise<{ connectionRef: string }>;
  listAccounts(connectionRef: string): Promise<ProviderAccount[]>;
  /** Opérations d'un compte depuis une date donnée, chacune portant une référence stable. */
  listTransactions(input: { connectionRef: string; accountRef: string; since: IsoDate }): Promise<ProviderTransaction[]>;
  /** Révoque le consentement chez le prestataire. */
  revokeConnection(connectionRef: string): Promise<void>;
}

export function getBankDataProvider(): BankDataProvider | null {
  return null;
}
