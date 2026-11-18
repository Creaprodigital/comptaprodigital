"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type SupportGrant = { id: string; admin: string; reason: string; createdAt: string; expiresAt: string; revokedAt: string | null; active: boolean; views: number };

/** Accès du support aux données financières de l'entreprise, révocables à tout moment par le titulaire. */
export function SupportAccess({ companyId, grants, canRevoke }: { companyId: string; grants: SupportGrant[]; canRevoke: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function revoke(id: string) {
    setBusy(id);
    try {
      await api(`/companies/${companyId}/access-grants/${id}`, { method: "DELETE" });
      toast.success("Accès révoqué.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlertIcon className="size-5" aria-hidden="true" /> Accès du support</CardTitle>
        <CardDescription>L'équipe de la plateforme ne consulte vos données financières qu'après justification, pour une durée limitée et en lecture seule. Vous êtes prévenu à chaque ouverture et pouvez y mettre fin à tout moment.</CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun accès n'a été ouvert sur cette entreprise.</p>
        ) : (
          <ul className="divide-y rounded-xl border text-sm">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {g.admin}
                    {g.active ? <Badge variant="warning">En cours</Badge> : g.revokedAt ? <Badge variant="secondary">Révoqué</Badge> : <Badge variant="secondary">Expiré</Badge>}
                  </p>
                  <p className="text-muted-foreground">{g.reason}</p>
                  <p className="text-xs text-muted-foreground">Ouvert le {formatDateTime(g.createdAt)} · {g.active ? `expire le ${formatDateTime(g.expiresAt)}` : `fermé le ${formatDateTime(g.revokedAt ?? g.expiresAt)}`} · {g.views} consultation(s)</p>
                </div>
                {g.active && canRevoke ? <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => revoke(g.id)}>Révoquer</Button> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
