"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import type { AiStatus } from "@/server/ai/service";
import { api, errorMessage } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Activation de l'assistant IA par l'entreprise : consentement explicite et révocable. */
export function AiSettingsCard({ companyId, status, canManage }: { companyId: string; status: AiStatus; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function toggle(enabled: boolean) {
    setPending(true);
    try {
      await api(`/companies/${companyId}/ai`, { method: "PUT", body: { enabled } });
      toast.success(enabled ? "Assistant IA activé." : "Assistant IA désactivé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-5" aria-hidden="true" /> Assistant IA
          {status.enabled ? <Badge variant="success">Activé</Badge> : <Badge variant="secondary">Désactivé</Badge>}
        </CardTitle>
        <CardDescription>Lecture des justificatifs, suggestions de catégories et réponses à vos questions, par le modèle Claude d'Anthropic.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!status.configured ? (
          <p className="text-muted-foreground">L'assistant IA n'est pas disponible sur cette plateforme pour le moment.</p>
        ) : !status.included ? (
          <p className="text-muted-foreground">
            L'assistant IA est inclus à partir de la formule Pro. <Link href="/app/abonnement" className="font-medium text-primary hover:underline">Voir les formules</Link>
          </p>
        ) : (
          <>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Les données nécessaires à chaque demande (document, libellés d'opérations, indicateurs) sont transmises à Anthropic, sous-traitant, pour le seul traitement de la demande.</li>
              <li>Les propositions de l'IA ne sont jamais appliquées d'elles-mêmes : vous les vérifiez et les validez.</li>
              <li>Vous pouvez désactiver l'assistant à tout moment.</li>
            </ul>
            {status.enabled ? (
              <p>
                Utilisation ce mois-ci : <span className="font-medium tabular-nums">{status.quota.used}</span>
                {status.quota.limit !== null ? ` / ${status.quota.limit} requêtes` : " requêtes"}
              </p>
            ) : null}
            {canManage ? (
              status.enabled ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => toggle(false)}>
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Désactiver l'assistant
                </Button>
              ) : (
                <>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5 size-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>J'accepte que les données nécessaires soient transmises à Anthropic pour le traitement des demandes d'IA.</span>
                  </label>
                  <Button type="button" disabled={!agreed || pending} onClick={() => toggle(true)}>
                    {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SparklesIcon />} Activer l'assistant
                  </Button>
                </>
              )
            ) : (
              <p className="text-muted-foreground">Seul le titulaire ou un administrateur de l'entreprise peut modifier ce réglage.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
