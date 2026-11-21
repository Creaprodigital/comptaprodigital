import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Faux serveur Bridge (API v3, version 2025-01-15) pour les tests : il implémente les seuls appels
 * utilisés par la plateforme, tels que décrits par la documentation officielle, et vérifie les
 * en-têtes obligatoires (Bridge-Version, Client-Id, Client-Secret, jeton d'utilisateur).
 */

export const FAKE_CLIENT_ID = "client_test";
export const FAKE_CLIENT_SECRET = "secret_test";

type Account = { id: number; name: string; balance: number; type: string; currency_code: string; item_id: number; data_access: "enabled" | "disabled"; iban?: string };
type Transaction = {
  id: number;
  clean_description: string;
  provider_description: string;
  amount: number;
  date: string;
  value_date?: string;
  updated_at: string;
  currency_code: string;
  deleted: boolean;
  future: boolean;
  account_id: number;
};
type Item = { id: number; status: number; status_code_info: string; status_code_description: string | null; authentication_expires_at: string | null; userUuid: string };

export class FakeBridge {
  server: Server;
  port = 0;
  users = new Map<string, { uuid: string; external_user_id: string }>();
  tokens = new Map<string, string>();
  items = new Map<number, Item>();
  accounts: Account[] = [];
  transactions: Transaction[] = [];
  sessions: Array<{ id: number; body: Record<string, unknown>; userUuid: string }> = [];
  /**
   * Simulation de la page Bridge Connect (tests de bout en bout) : appelée quand le navigateur ouvre l'URL
   * de session, elle crée l'item de l'utilisateur et retourne son identifiant ; le navigateur est ensuite
   * renvoyé vers `callback_url`, avec les paramètres décrits par la documentation.
   */
  onConnect: ((userUuid: string, existingItemId: number | null) => number) | null = null;
  requests: Array<{ method: string; path: string }> = [];
  /** Taille des pages de la liste des opérations (pour tester la pagination). */
  pageSize = 2;
  private counter: number;
  private clock = Date.parse("2026-11-01T08:00:00.000Z");

  /** `firstId` : point de départ des identifiants (une base de bout en bout conserve les items des exécutions précédentes). */
  constructor(firstId = 0) {
    this.counter = firstId;
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => this.handle(req, res, raw));
    });
  }

  async start(port = 0): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${this.port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Horodatage croissant, comme `updated_at` chez Bridge. */
  tick(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }

  addItem(userUuid: string, status = 0): Item {
    const item: Item = { id: 7_000_000 + ++this.counter, status, status_code_info: status === 0 ? "ok" : "otp_required", status_code_description: status === 0 ? null : "Veuillez saisir le code reçu de votre banque", authentication_expires_at: "2027-05-01T10:00:00Z", userUuid };
    this.items.set(item.id, item);
    return item;
  }

  addAccount(itemId: number, data: Partial<Account> = {}): Account {
    const account: Account = { id: 48_000_000 + ++this.counter, name: "Compte courant pro", balance: 0, type: "checking", currency_code: "EUR", item_id: itemId, data_access: "enabled", ...data };
    this.accounts.push(account);
    return account;
  }

  addTransaction(accountId: number, data: Partial<Transaction> & { amount: number; date: string }): Transaction {
    const t: Transaction = { id: 33_000_000_000_000 + ++this.counter, clean_description: "Opération", provider_description: "OPERATION", currency_code: "EUR", deleted: false, future: false, account_id: accountId, updated_at: this.tick(), ...data };
    this.transactions.push(t);
    return t;
  }

  updateTransaction(id: number, data: Partial<Transaction>) {
    const t = this.transactions.find((x) => x.id === id)!;
    Object.assign(t, data, { updated_at: this.tick() });
  }

  private json(res: ServerResponse, status: number, body?: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  }

  private userOf(req: IncomingMessage): string | null {
    const auth = req.headers.authorization ?? "";
    return this.tokens.get(auth.replace(/^Bearer /, "")) ?? null;
  }

  private page<T>(url: URL, path: string, rows: T[]) {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), this.pageSize);
    const offset = Number(url.searchParams.get("after") ?? 0);
    const slice = rows.slice(offset, offset + limit);
    const next = offset + limit < rows.length ? new URLSearchParams(url.searchParams) : null;
    next?.set("after", String(offset + limit));
    return { resources: slice, generated_at: new Date().toISOString(), pagination: { next_uri: next ? `${path}?${next}` : "null" } };
  }

  private handle(req: IncomingMessage, res: ServerResponse, raw: string) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    this.requests.push({ method: req.method ?? "GET", path });
    const connect = /^\/connect\/session\/(\d+)$/.exec(path);
    if (req.method === "GET" && connect) {
      const session = this.sessions.find((s) => s.id === Number(connect[1]));
      if (!session || !this.onConnect) return this.json(res, 404, { code: "not_found" });
      const itemId = this.onConnect(session.userUuid, session.body.item_id ? Number(session.body.item_id) : null);
      const back = new URL(String(session.body.callback_url));
      for (const [key, value] of Object.entries({ item_id: String(itemId), user_uuid: session.userUuid, success: "true", source: "connect", context: String(session.body.context ?? "") })) back.searchParams.set(key, value);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (req.headers["bridge-version"] !== "2025-01-15" || req.headers["client-id"] !== FAKE_CLIENT_ID || req.headers["client-secret"] !== FAKE_CLIENT_SECRET) {
      return this.json(res, 401, { code: "invalid_client_credentials", message: "client_id and client_secret are invalid" });
    }
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    if (req.method === "POST" && path === "/v3/aggregation/users") {
      const external = String(body.external_user_id ?? "");
      if ([...this.users.values()].some((u) => u.external_user_id === external)) return this.json(res, 409, { code: "conflict", message: "User already exists" });
      const user = { uuid: `c2a26c9e-0000-4000-8000-${String(++this.counter).padStart(12, "0")}`, external_user_id: external };
      this.users.set(user.uuid, user);
      return this.json(res, 201, user);
    }
    if (req.method === "DELETE" && path.startsWith("/v3/aggregation/users/")) {
      const uuid = path.split("/").pop()!;
      if (!this.users.delete(uuid)) return this.json(res, 404, { code: "not_found" });
      for (const [id, item] of this.items) if (item.userUuid === uuid) this.items.delete(id);
      return this.json(res, 204);
    }
    if (req.method === "POST" && path === "/v3/aggregation/authorization/token") {
      const user = body.user_uuid ? this.users.get(String(body.user_uuid)) : [...this.users.values()].find((u) => u.external_user_id === body.external_user_id);
      if (!user) return this.json(res, 404, { code: "not_found", message: "User not found" });
      const token = `tok_${++this.counter}`;
      this.tokens.set(token, user.uuid);
      return this.json(res, 201, { access_token: token, expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(), user });
    }

    const userUuid = this.userOf(req);
    if (!userUuid) return this.json(res, 401, { code: "unauthorized", message: "Invalid token" });
    const userItems = new Set([...this.items.values()].filter((i) => i.userUuid === userUuid).map((i) => i.id));

    if (req.method === "POST" && path === "/v3/aggregation/connect-sessions") {
      const id = ++this.counter;
      this.sessions.push({ id, body, userUuid });
      return this.json(res, 201, { id: `sess-${id}`, url: `http://127.0.0.1:${this.port}/connect/session/${id}` });
    }
    if (path.startsWith("/v3/aggregation/items/")) {
      const id = Number(path.split("/").pop());
      const item = this.items.get(id);
      if (!item || item.userUuid !== userUuid) return this.json(res, 404, { code: "not_found" });
      if (req.method === "DELETE") {
        this.items.delete(id);
        return this.json(res, 204);
      }
      const { userUuid: _owner, ...publicItem } = item;
      void _owner;
      return this.json(res, 200, { ...publicItem, provider_id: 574, account_types: "payment" });
    }
    if (req.method === "GET" && path === "/v3/aggregation/accounts") {
      const itemId = url.searchParams.get("item_id");
      const rows = this.accounts.filter((a) => userItems.has(a.item_id) && (!itemId || String(a.item_id) === itemId)).map((a) => (a.data_access === "disabled" ? { ...a, balance: undefined, iban: undefined } : a));
      return this.json(res, 200, this.page(url, path, rows));
    }
    if (req.method === "GET" && path === "/v3/aggregation/transactions") {
      const accountId = url.searchParams.get("account_id");
      const since = url.searchParams.get("since");
      const visible = new Set(this.accounts.filter((a) => userItems.has(a.item_id) && a.data_access === "enabled").map((a) => a.id));
      const rows = this.transactions
        .filter((t) => visible.has(t.account_id) && (!accountId || String(t.account_id) === accountId) && (!since || Date.parse(t.updated_at) > Date.parse(since)))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      return this.json(res, 200, this.page(url, path, rows));
    }
    return this.json(res, 404, { code: "not_found", message: `${req.method} ${path}` });
  }
}
