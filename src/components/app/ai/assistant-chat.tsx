"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2Icon, RotateCcwIcon, SendIcon, SparklesIcon } from "lucide-react";
import type { AssistantReply } from "@/server/ai/assistant";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

type Turn = { role: "user" | "assistant"; content: string; sources?: AssistantReply["sources"]; error?: boolean };

const EXAMPLES = [
  "Quel est mon résultat estimé depuis le début de l'exercice ?",
  "Quelles dépenses n'ont pas de justificatif ?",
  "Retrouve le paiement de mon fournisseur d'énergie le mois dernier.",
  "Explique-moi la différence entre solde bancaire et trésorerie disponible.",
];

/** Conversation avec l'assistant. Elle n'est conservée que dans cet onglet du navigateur. */
export function AssistantChat({ companyId }: { companyId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const history = [...turns.filter((t) => !t.error), { role: "user" as const, content: text }];
    setTurns((t) => [...t, { role: "user", content: text }]);
    setInput("");
    setPending(true);
    try {
      const reply = await api<AssistantReply>(`/companies/${companyId}/assistant`, { method: "POST", body: { messages: history.map(({ role, content }) => ({ role, content })) } });
      setTurns((t) => [...t, { role: "assistant", content: reply.answer, sources: reply.sources }]);
    } catch (error) {
      setTurns((t) => [...t, { role: "assistant", content: errorMessage(error), error: true }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-2xl border bg-card">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {turns.length === 0 ? (
          <div className="mx-auto max-w-xl py-8 text-center">
            <SparklesIcon className="mx-auto size-8 text-primary" aria-hidden="true" />
            <p className="mt-3 font-medium">Posez une question sur votre activité</p>
            <p className="mt-1 text-sm text-muted-foreground">L'assistant consulte vos données en lecture seule ; il ne modifie rien.</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => ask(example)} className="rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((turn, index) => (
          <div key={index} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[42rem] rounded-2xl px-4 py-3 text-sm", turn.role === "user" ? "bg-primary text-primary-foreground" : turn.error ? "border border-destructive/25 bg-destructive-soft" : "bg-muted")}>
              <p className="whitespace-pre-line">{turn.content}</p>
              {turn.sources?.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-2">
                  {turn.sources.map((s) => (
                    <li key={s.href}>
                      <Link href={s.href} className="inline-block rounded-md border bg-background px-2 py-0.5 text-xs hover:text-primary">{s.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> L'assistant consulte vos données…</p>
        ) : null}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Votre question…"
          aria-label="Votre question"
          className="min-h-0 flex-1 resize-none"
        />
        {turns.length ? (
          <Button type="button" variant="ghost" size="icon" onClick={() => setTurns([])} disabled={pending} aria-label="Nouvelle conversation">
            <RotateCcwIcon />
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || !input.trim()} aria-label="Envoyer">
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon />}
        </Button>
      </form>
    </div>
  );
}
