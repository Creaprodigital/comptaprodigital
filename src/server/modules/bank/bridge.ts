import { createHmac, timingSafeEqual } from "node:crypto";
import type { BankConnectionStatus } from "@prisma/client";
import { AppError } from "@/server/http/errors";
import { dec } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { BankDataProvider, ProviderAccount, ProviderItem, ProviderTransaction } from "./provider";

/**
 * Client de l'API Bridge (version 2025-01-15, https://docs.bridgeapi.io).
 *
 *  - Une entreprise correspond à un utilisateur Bridge, créé avec `external_user_id` = identifiant
 *    de l'entreprise ; les appels portant sur ses données utilisent un jeton d'accès valable deux
 *    heures, demandé côté serveur avec les identifiants de l'application.
 *  - La connexion à la banque se fait sur Bridge Connect (page hébergée par Bridge) : la plateforme
 *    ne voit jamais les identifiants bancaires.
 *  - Les identifiants de l'application et les jetons ne quittent jamais le serveur.
 */

export const BRIDGE_VERSION = "2025-01-15";

/** Types de comptes repris en comptabilité : comptes courants et comptes d'épargne. */
export const SYNCED_ACCOUNT_TYPES = new Set(["checking", "savings"]);

type Config = { clientId: string; clientSecret: string; baseUrl: string };

type BridgeAccount = { id: number | string; name?: string; balance?: number | null; type?: string; currency_code?: string; item_id: number | string; data_access?: string; iban?: string | null };
type BridgeTransaction = {
  id: number | string;
  clean_description?: string | null;
  provider_description?: string | null;
  amount: number;
  date: string;
  value_date?: string | null;
  updated_at: string;
  currency_code?: string;
  deleted?: boolean;
  future?: boolean;
  account_id: number | string;
};
type BridgeItem = { id: number | string; status: number; status_code_info?: string | null; status_code_description?: string | null; authentication_expires_at?: string | null };
type Page<T> = { resources: T[]; pagination?: { next_uri?: string | null } };

/**
 * État d'une connexion selon le code Bridge (« Items statuses ») :
 * 0 = à jour ; -2 / -3 = rafraîchissement en cours ; 402, 429, 1010 = action de l'utilisateur
 * requise (identifiants, conditions à accepter, authentification forte) ; autres = erreur.
 */
export function bridgeStatus(code: number): BankConnectionStatus {
  if (code === 0) return "ACTIVE";
  if (code === -2 || code === -3) return "SYNCING";
  if (code === 402 || code === 429 || code === 1010) return "ACTION_REQUIRED";
  return "ERROR";
}

/** Montant JSON (nombre décimal) converti sans arithmétique flottante. */
function amountOf(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return dec(String(value)).toFixed(2);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BridgeProvider implements BankDataProvider {
  readonly key = "bridge";
  readonly label = "Bridge";
  private tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: Config) {}

  private async request<T>(method: string, path: string, options: { body?: unknown; token?: string; allow404?: boolean } = {}): Promise<T | null> {
    if (!path.startsWith("/v3/")) throw new Error(`Chemin Bridge inattendu : ${path}`);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.baseUrl), {
        method,
        headers: {
          "Bridge-Version": BRIDGE_VERSION,
          "Client-Id": this.config.clientId,
          "Client-Secret": this.config.clientSecret,
          accept: "application/json",
          "Accept-Language": "fr",
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (error) {
      throw new AppError(502, "BANK_PROVIDER_UNAVAILABLE", `Bridge est injoignable (${error instanceof Error ? error.message : "erreur réseau"}). Réessayez dans quelques minutes.`);
    }
    if (response.status === 404 && options.allow404) return null;
    if (response.status === 204) return null;
    const text = await response.text();
    if (!response.ok) {
      let detail = "";
      try {
        const json = JSON.parse(text) as { code?: string; message?: string };
        detail = [json.code, json.message].filter(Boolean).join(" : ");
      } catch {
        detail = text.slice(0, 200);
      }
      if (response.status === 429) throw new AppError(503, "BANK_PROVIDER_RATE_LIMITED", "Bridge limite temporairement les demandes : réessayez dans quelques minutes.");
      throw new BridgeError(response.status, detail);
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  private async paginate<T>(path: string, token: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = path;
    for (let guard = 0; next && guard < 1000; guard++) {
      const page: Page<T> | null = await this.request<Page<T>>("GET", next, { token });
      items.push(...(page?.resources ?? []));
      const uri: string | null | undefined = page?.pagination?.next_uri;
      next = uri && uri !== "null" ? uri : null;
    }
    return items;
  }

  private async token(userRef: string): Promise<string> {
    const cached = this.tokens.get(userRef);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token;
    const result = await this.request<{ access_token: string; expires_at: string }>("POST", "/v3/aggregation/authorization/token", { body: { user_uuid: userRef } });
    if (!result?.access_token) throw new BridgeError(502, "jeton d'accès absent de la réponse");
    const expiresAt = Date.parse(result.expires_at);
    this.tokens.set(userRef, { token: result.access_token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3600_000 });
    return result.access_token;
  }

  async ensureUser(companyId: string, knownUserRef: string | null): Promise<string> {
    if (knownUserRef) return knownUserRef;
    try {
      const user = await this.request<{ uuid: string }>("POST", "/v3/aggregation/users", { body: { external_user_id: companyId } });
      if (!user?.uuid) throw new BridgeError(502, "identifiant d'utilisateur absent de la réponse");
      return user.uuid;
    } catch (error) {
      // 409 : l'utilisateur existe déjà (connexion précédente révoquée) ; il est retrouvé par la référence de l'entreprise.
      if (!(error instanceof BridgeError) || error.providerStatus !== 409) throw error;
      const auth = await this.request<{ access_token: string; expires_at: string; user: { uuid: string } }>("POST", "/v3/aggregation/authorization/token", { body: { external_user_id: companyId } });
      if (!auth?.user?.uuid) throw new BridgeError(502, "utilisateur introuvable");
      this.tokens.set(auth.user.uuid, { token: auth.access_token, expiresAt: Date.parse(auth.expires_at) || Date.now() + 3600_000 });
      return auth.user.uuid;
    }
  }

  async createConnectSession(input: { userRef: string; userEmail: string; callbackUrl: string; context: string; itemRef?: string }): Promise<{ redirectUrl: string }> {
    const token = await this.token(input.userRef);
    const body = input.itemRef
      ? { item_id: Number(input.itemRef), callback_url: input.callbackUrl, context: input.context, account_types: "payment" }
      : { user_email: input.userEmail, callback_url: input.callbackUrl, context: input.context, account_types: "payment", country_code: "FR" };
    const session = await this.request<{ id: string; url: string }>("POST", "/v3/aggregation/connect-sessions", { body, token });
    // Le navigateur de l'utilisateur est redirigé vers cette adresse : elle doit être en HTTPS (faux serveur local en test).
    const local = this.config.baseUrl.startsWith("http://127.0.0.1");
    if (!session?.url || !(session.url.startsWith("https://") || (local && session.url.startsWith("http://127.0.0.1")))) throw new BridgeError(502, "URL de session absente ou invalide");
    return { redirectUrl: session.url };
  }

  async getItem(userRef: string, itemRef: string): Promise<ProviderItem | null> {
    const token = await this.token(userRef);
    const item = await this.request<BridgeItem>("GET", `/v3/aggregation/items/${encodeURIComponent(itemRef)}`, { token, allow404: true });
    if (!item) return null;
    return {
      ref: String(item.id),
      status: bridgeStatus(item.status),
      statusCode: item.status,
      statusInfo: item.status_code_info ?? null,
      statusDescription: item.status_code_description ?? null,
      authenticationExpiresAt: item.authentication_expires_at ? new Date(item.authentication_expires_at) : null,
    };
  }

  async listAccounts(userRef: string, itemRef: string): Promise<ProviderAccount[]> {
    const token = await this.token(userRef);
    const accounts = await this.paginate<BridgeAccount>(`/v3/aggregation/accounts?limit=500&item_id=${encodeURIComponent(itemRef)}`, token);
    return accounts
      .filter((a) => String(a.item_id) === itemRef)
      .map((a) => ({
        ref: String(a.id),
        itemRef: String(a.item_id),
        name: (a.name ?? "Compte bancaire").slice(0, 100),
        type: a.type ?? "unknown",
        iban: a.iban ? a.iban.replace(/\s+/g, "").toUpperCase() : null,
        currency: (a.currency_code ?? "EUR").toUpperCase(),
        balance: amountOf(a.balance),
        enabled: a.data_access !== "disabled",
      }));
  }

  async listTransactions(userRef: string, accountRef: string, since: string | null): Promise<ProviderTransaction[]> {
    const token = await this.token(userRef);
    const query = new URLSearchParams({ limit: "500", account_id: accountRef });
    if (since) query.set("since", since);
    const rows = await this.paginate<BridgeTransaction>(`/v3/aggregation/transactions?${query}`, token);
    const result: ProviderTransaction[] = [];
    for (const row of rows) {
      const amount = amountOf(row.amount);
      if (String(row.account_id) !== accountRef || !amount || !ISO_DATE.test(row.date)) continue;
      const raw = (row.provider_description ?? row.clean_description ?? "").trim();
      const label = (row.clean_description ?? row.provider_description ?? "").trim() || "Opération bancaire";
      result.push({
        ref: String(row.id),
        accountRef,
        date: row.date as IsoDate,
        valueDate: row.value_date && ISO_DATE.test(row.value_date) ? (row.value_date as IsoDate) : undefined,
        label: label.slice(0, 255),
        rawLabel: (raw || label).slice(0, 512),
        amount,
        currency: (row.currency_code ?? "EUR").toUpperCase(),
        updatedAt: row.updated_at,
        deleted: row.deleted === true,
        future: row.future === true,
      });
    }
    return result;
  }

  async deleteItem(userRef: string, itemRef: string): Promise<void> {
    const token = await this.token(userRef);
    await this.request("DELETE", `/v3/aggregation/items/${encodeURIComponent(itemRef)}`, { token, allow404: true });
  }

  async deleteUser(userRef: string): Promise<void> {
    await this.request("DELETE", `/v3/aggregation/users/${encodeURIComponent(userRef)}`, { allow404: true });
    this.tokens.delete(userRef);
  }
}

export class BridgeError extends AppError {
  constructor(
    readonly providerStatus: number,
    detail: string,
  ) {
    super(502, "BANK_PROVIDER_ERROR", `Bridge a refusé la demande (${providerStatus}${detail ? ` — ${detail}` : ""}).`);
  }
}

/**
 * Vérifie l'en-tête `BridgeApi-Signature` : une ou plusieurs signatures `v1=<HMAC-SHA256 hexadécimal>`
 * du corps brut, calculées avec le secret du webhook (deux pendant les 24 h qui suivent un changement
 * de secret). Les autres schémas sont ignorés (protection contre le déclassement).
 */
export function verifyBridgeSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return header.split(",").some((part) => {
    const [scheme, value] = part.trim().split("=", 2);
    if (scheme !== "v1" || !value || !/^[0-9a-fA-F]{64}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value, "hex"), expected);
  });
}
