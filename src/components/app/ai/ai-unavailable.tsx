import Link from "next/link";
import { SparklesIcon } from "lucide-react";
import type { AiStatus } from "@/server/ai/service";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Explique pourquoi l'IA n'est pas utilisable, et comment l'activer. */
export function AiUnavailable({ status, compact = false }: { status: AiStatus; compact?: boolean }) {
  const [message, action] = !status.configured
    ? ["L'assistant IA n'est pas disponible sur cette plateforme pour le moment.", null]
    : !status.included
      ? ["L'assistant IA est inclus à partir de la formule Pro.", { href: "/app/abonnement", label: "Voir les formules" }]
      : !status.enabled
        ? ["L'assistant IA n'est pas activé pour cette entreprise. Le titulaire ou un administrateur peut l'activer dans les paramètres de l'entreprise.", { href: "/app/entreprise/parametres", label: "Paramètres de l'entreprise" }]
        : [`Le quota mensuel de ${status.quota.limit} requêtes d'IA est atteint ; il sera renouvelé le 1er du mois prochain.`, null];
  const body = (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <SparklesIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-muted-foreground">{message}</p>
      {action ? (
        <Button asChild variant="outline" size="sm">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
  return compact ? body : <Card><CardContent className="py-6">{body}</CardContent></Card>;
}
