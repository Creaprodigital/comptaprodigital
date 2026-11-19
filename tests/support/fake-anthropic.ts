import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Faux serveur de l'API Anthropic pour les tests : il reçoit les requêtes réellement
 * émises par le SDK (@anthropic-ai/sdk) et répond par des messages scriptés.
 * Chaque test empile ses réponses avec `reply(...)` ; les requêtes reçues sont conservées.
 */

type Obj = Record<string, unknown>;
export type FakeContent = Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Obj }>;
type Responder = (request: Obj) => { content: FakeContent; stop_reason?: string; status?: number; error?: Obj };

export class FakeAnthropic {
  server: Server;
  requests: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: Obj }> = [];
  private queue: Responder[] = [];
  private counter = 0;

  constructor() {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = raw ? (JSON.parse(raw) as Obj) : {};
        this.requests.push({ path: new URL(req.url ?? "/", "http://localhost").pathname, headers: req.headers, body });
        const responder = this.queue.shift();
        if (!responder) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Aucune réponse scriptée" } }));
          return;
        }
        const out = responder(body);
        if (out.status && out.status >= 400) {
          res.writeHead(out.status, { "Content-Type": "application/json", "x-should-retry": "false" });
          res.end(JSON.stringify({ type: "error", error: out.error ?? { type: "api_error", message: "Erreur simulée" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", "request-id": `req_${++this.counter}` });
        res.end(
          JSON.stringify({
            id: `msg_${this.counter}`,
            type: "message",
            role: "assistant",
            model: String(body.model),
            content: out.content,
            stop_reason: out.stop_reason ?? (out.content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn"),
            stop_sequence: null,
            usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }),
        );
      });
    });
  }

  /** Empile une réponse (texte JSON pour une sortie structurée, ou appels d'outils). */
  reply(responder: Responder | FakeContent) {
    this.queue.push(typeof responder === "function" ? responder : () => ({ content: responder }));
  }

  replyJson(value: unknown) {
    this.reply([{ type: "text", text: JSON.stringify(value) }]);
  }

  pending() {
    return this.queue.length;
  }

  reset() {
    this.queue = [];
    this.requests = [];
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
