import { FakeAnthropic } from "./fake-anthropic";

/**
 * Faux serveur Anthropic pour les tests de bout en bout : la réponse est déduite de la
 * requête (lecture de document, suggestions de catégories, assistant à outils), afin
 * que l'application de production soit exercée sans appel réel à l'API.
 */

type Obj = Record<string, unknown>;
type Block = { type: string; text?: string; content?: unknown };
type Message = { role: string; content: string | Block[] };

const textOf = (message: Message) => (typeof message.content === "string" ? message.content : message.content.map((b) => b.text ?? "").join("\n"));

export function autoRespond(request: Obj) {
  const messages = request.messages as Message[];
  const last = messages.at(-1)!;
  const text = textOf(last);
  const isPdf = Array.isArray(last.content) && last.content.some((b) => b.type === "document" || b.type === "image");

  if (isPdf) {
    const category = /^(\S+) — [^—]*(Télécom|Logiciel)[^—]* — dépense$/m.exec(text)?.[1] ?? /^(\S+) — .* — dépense$/m.exec(text)?.[1] ?? null;
    const today = new Date().toISOString().slice(0, 10);
    return { content: [{ type: "text" as const, text: JSON.stringify({ documentType: "PURCHASE_INVOICE", supplierName: "Hébergeur Nuage", supplierSiren: null, supplierVatNumber: null, invoiceNumber: "HN-2026-0042", issueDate: today, dueDate: null, currency: "EUR", totalExclTax: "25.00", totalVat: "5.00", totalInclTax: "30.00", vatLines: [{ rate: "20", base: "25.00", amount: "5.00" }], label: "Hébergement du site", operationCategory: "SERVICES", suggestedCategoryId: category, confidence: "high", remarks: [] }) }] };
  }
  if (text.includes("Opérations à catégoriser")) {
    const expense = /^(\S+) \| [^|]+ \| dépense$/m.exec(text)?.[1] ?? null;
    const lines = text.split("Opérations à catégoriser")[1].split("\n").filter((l) => / \| /.test(l));
    const suggestions = lines.map((l) => {
      const [transactionId, , label, amount] = l.split(" | ");
      return { transactionId, categoryId: amount.startsWith("-") ? expense : null, vatRate: "20", confidence: "high", reason: `Libellé « ${label} »` };
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ suggestions }) }] };
  }
  if (Array.isArray(request.tools)) {
    const lastIsToolResult = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
    if (!lastIsToolResult) return { content: [{ type: "tool_use" as const, id: `toolu_${Date.now()}`, name: "controles", input: {} }] };
    return { content: [{ type: "text" as const, text: "J'ai consulté les contrôles de l'entreprise : voici les points à examiner en priorité." }] };
  }
  return { content: [{ type: "text" as const, text: "D'accord." }] };
}

export function startAutoFake(port: number) {
  const fake = new FakeAnthropic();
  // Chaque requête consomme une réponse : on en fournit une nouvelle à la demande.
  const original = fake.server.listeners("request")[0] as (...args: unknown[]) => void;
  fake.server.removeAllListeners("request");
  fake.server.on("request", (...args: unknown[]) => {
    const req = args[0] as { method?: string };
    if (req.method === "POST") fake.reply(autoRespond);
    original(...args);
  });
  return new Promise<FakeAnthropic>((resolve) => fake.server.listen(port, "127.0.0.1", () => resolve(fake)));
}
