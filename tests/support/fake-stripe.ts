import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Faux serveur Stripe pour les tests : il implémente les seuls appels utilisés par
 * la plateforme (clients, sessions Checkout et portail, abonnements, produits et
 * prix) et conserve l'état en mémoire. Les webhooks sont signés par le SDK Stripe
 * lui-même (generateTestHeaderString), avec le même secret que l'application.
 */

type Obj = Record<string, unknown>;

/** Décodage des paramètres « à crochets » envoyés par le SDK (line_items[0][price]=…). */
export function parseForm(body: string): Obj {
  const result: Obj = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const keys = rawKey.replace(/\]/g, "").split("[");
    let node: Obj = result;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) node[key] = value;
      else node = (node[key] ??= /^\d+$/.test(keys[index + 1]) ? [] : {}) as Obj;
    });
  }
  return result;
}

export class FakeStripe {
  server: Server;
  port = 0;
  customers = new Map<string, Obj>();
  sessions = new Map<string, Obj>();
  subscriptions = new Map<string, Obj>();
  products = new Map<string, Obj>();
  prices = new Map<string, Obj>();
  requests: Array<{ method: string; path: string; body: Obj }> = [];
  private counter = 0;

  constructor() {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const body = parseForm(raw);
        this.requests.push({ method: req.method ?? "GET", path: url.pathname, body });
        const [status, payload] = this.route(req.method ?? "GET", url.pathname, body);
        res.writeHead(status, { "Content-Type": "application/json", "Request-Id": `req_${++this.counter}` });
        res.end(JSON.stringify(payload));
      });
    });
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${this.port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  id(prefix: string) {
    return `${prefix}_test${++this.counter}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Crée un prix récurrent rattaché à une formule. */
  addPrice(planKey: string, interval: "month" | "year", unitAmount: number): string {
    const id = this.id("price");
    this.prices.set(id, { id, object: "price", active: true, currency: "eur", unit_amount: unitAmount, recurring: { interval }, metadata: { planKey }, product: "prod_x" });
    return id;
  }

  /** Simule le paiement de la session Checkout : l'abonnement Stripe est créé. */
  completeSession(sessionId: string, status = "active"): Obj {
    const session = this.sessions.get(sessionId)!;
    const priceId = ((session.line_items as Obj[])[0] as Obj).price as string;
    const sub = this.makeSubscription(session.customer as string, priceId, status, (session.subscription_data as Obj | undefined)?.metadata as Obj | undefined, (session.subscription_data as Obj | undefined)?.trial_end as string | undefined);
    session.subscription = sub.id;
    session.status = "complete";
    return sub;
  }

  makeSubscription(customer: string, priceId: string, status: string, metadata: Obj = {}, trialEnd?: string): Obj {
    const now = Math.floor(Date.now() / 1000);
    const id = this.id("sub");
    const sub: Obj = {
      id,
      object: "subscription",
      customer,
      status,
      metadata,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      trial_end: trialEnd ? Number(trialEnd) : null,
      items: { object: "list", data: [{ id: this.id("si"), object: "subscription_item", price: this.prices.get(priceId), current_period_start: now, current_period_end: now + 30 * 86400 }] },
    };
    this.subscriptions.set(id, sub);
    return sub;
  }

  private route(method: string, path: string, body: Obj): [number, unknown] {
    const parts = path.split("/").filter(Boolean); // ["v1", resource, id?]
    const resource = parts.slice(1, -1).join("/") || parts[1];
    const id = parts.length > 2 ? parts.at(-1)! : null;
    const notFound: [number, unknown] = [404, { error: { type: "invalid_request_error", message: "No such object" } }];

    if (method === "POST" && path === "/v1/customers") {
      const customer = { id: this.id("cus"), object: "customer", ...body };
      this.customers.set(customer.id, customer);
      return [200, customer];
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const session = { id: this.id("cs"), object: "checkout.session", url: `https://checkout.stripe.test/${this.counter}`, status: "open", subscription: null, ...body };
      this.sessions.set(session.id, session);
      return [200, session];
    }
    if (method === "GET" && resource === "checkout/sessions" && id) return this.sessions.has(id) ? [200, this.sessions.get(id)] : notFound;
    if (method === "POST" && path === "/v1/billing_portal/sessions") return [200, { id: this.id("bps"), object: "billing_portal.session", url: "https://billing.stripe.test/session", ...body }];
    if (resource === "subscriptions" && id) {
      const sub = this.subscriptions.get(id);
      if (!sub) return notFound;
      if (method === "DELETE") {
        Object.assign(sub, { status: "canceled", canceled_at: Math.floor(Date.now() / 1000), ended_at: Math.floor(Date.now() / 1000) });
        return [200, sub];
      }
      if (method === "POST") {
        if (body.cancel_at_period_end !== undefined) sub.cancel_at_period_end = body.cancel_at_period_end === "true";
        if (body.metadata) sub.metadata = { ...(sub.metadata as Obj), ...(body.metadata as Obj) };
        const items = body.items as Obj[] | undefined;
        if (items?.[0]?.price) ((sub.items as Obj).data as Obj[])[0].price = this.prices.get(items[0].price as string);
      }
      return [200, sub];
    }
    if (method === "POST" && path === "/v1/products") {
      const product = { id: this.id("prod"), object: "product", active: true, ...body };
      this.products.set(product.id, product);
      return [200, product];
    }
    if (method === "GET" && path === "/v1/products") return [200, { object: "list", data: [...this.products.values()].slice(0, 1), has_more: false }];
    if (resource === "products" && id && method === "POST") {
      const product = this.products.get(id);
      if (!product) return notFound;
      Object.assign(product, body);
      return [200, product];
    }
    if (method === "POST" && path === "/v1/prices") {
      const recurring = body.recurring as Obj;
      const price = { id: this.id("price"), object: "price", active: true, currency: body.currency, unit_amount: Number(body.unit_amount), recurring: { interval: recurring.interval }, metadata: body.metadata ?? {}, product: body.product };
      this.prices.set(price.id, price);
      return [200, price];
    }
    if (resource === "prices" && id) {
      const price = this.prices.get(id);
      if (!price) return notFound;
      if (method === "POST" && body.active !== undefined) price.active = body.active === "true";
      return [200, price];
    }
    return [400, { error: { type: "invalid_request_error", message: `Non simulé : ${method} ${path}` } }];
  }
}
