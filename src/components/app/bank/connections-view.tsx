"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2Icon, Loader2Icon, RefreshCwIcon, ShieldAlertIcon, UnplugIcon } from "lucide-react";
import { toast } from "sonner";
import type { BankConnectionView } from "@/server/modules/bank/connections";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STATUS: Record<BankConnectionView["status"], { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  ACTIVE: { label: "À jour", variant: "success" },
  SYNCING: { label: "Synchronisation en cours", variant: "secondary" },
  ACTION_REQUIRED: { label: "Action requise", variant: "warning" },
  ERROR: { label: "Erreur temporaire", variant: "destructive" },
  REVOKED: { label: "Révoquée", variant: "secondary" },
};

/** Démarre le parcours Bridge (nouvelle connexion ou renouvellement) puis redirige le navigateur. */
async function startConnect(companyId: string, connectionId?: string) {
  const { redirectUrl } = await api<{ redirectUrl: string }>(`/companies/${companyId}/bank/connections`, { method: "POST", body: connectionId ? { connectionId } : {} });
  window.location.assign(redirectUrl);
}

export function ConnectBankButton({ companyId }: { companyId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await startConnect(companyId);
        } catch (error) {
          toast.error(errorMessage(error));
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <Link2Icon />} Connecter une banque
    </Button>
  );
}

function ConnectionCard({ companyId, connection, canWrite }: { companyId: string; connection: BankConnectionView; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"sync" | "reauth" | "revoke" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const status = STATUS[connection.status];
  const expiresSoon = connection.authenticationExpiresSoon;

  async function run(kind: "sync" | "reauth" | "revoke") {
    setPending(kind);
    try {
      if (kind === "reauth") return await startConnect(companyId, connection.id);
      if (kind === "sync") {
        const result = await api<{ imported: number; error: string | null }>(`/companies/${companyId}/bank/connections/${connection.id}/sync`, { method: "POST" });
        if (result.error) toast.error(`Synchronisation incomplète : ${result.error}`);
        else toast.success(result.imported > 0 ? `${result.imported} opération${result.imported > 1 ? "s" : ""} importée${result.imported > 1 ? "s" : ""}.` : "Comptes à jour.");
      } else {
        await api(`/companies/${companyId}/bank/connections/${connection.id}`, { method: "DELETE" });
        toast.success("Connexion révoquée. Les comptes et leurs opérations sont conservés.");
        setConfirm(false);
      }
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setPending(null);
  }

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{connection.accounts.length > 0 ? connection.accounts.map((a) => a.name).join(", ") : "Connexion bancaire"}</p>
            <p className="text-sm text-muted-foreground">
              Via Bridge · {connection.lastSyncedAt ? `synchronisée le ${formatDate(connection.lastSyncedAt)} à ${new Date(connection.lastSyncedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "jamais synchronisée"}
            </p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {connection.status === "ACTION_REQUIRED" || connection.status === "ERROR" ? (
          <p className="flex gap-2 text-sm">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            {connection.statusDescription ?? (connection.status === "ACTION_REQUIRED" ? "Votre banque demande une nouvelle authentification." : "La banque n'a pas pu être interrogée ; Bridge réessaiera automatiquement.")}
          </p>
        ) : expiresSoon ? (
          <p className="flex gap-2 text-sm">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            L'autorisation d'accès donnée à votre banque expire le {formatDate(connection.authenticationExpiresAt!)} : renouvelez-la pour ne pas interrompre la synchronisation.
          </p>
        ) : null}
        {connection.lastError ? <p className="text-sm text-destructive-foreground">Dernière synchronisation en échec : {connection.lastError}</p> : null}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run("sync")}>
              {pending === "sync" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Synchroniser
            </Button>
            {connection.status === "ACTION_REQUIRED" || expiresSoon ? (
              <Button size="sm" disabled={pending !== null} onClick={() => run("reauth")}>
                {pending === "reauth" ? <Loader2Icon className="animate-spin" /> : <Link2Icon />} Renouveler l'accès
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setConfirm(true)}>
              <UnplugIcon /> Déconnecter
            </Button>
          </div>
        ) : null}
      </CardContent>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Déconnecter cette banque ?</DialogTitle>
            <DialogDescription>
              Le consentement est révoqué chez Bridge : plus aucune opération ne sera récupérée. Les comptes, leurs opérations et les écritures comptables sont conservés ; vous pourrez
              continuer à les alimenter par import de relevés.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuler</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending !== null} onClick={() => run("revoke")}>
              {pending === "revoke" ? <Loader2Icon className="animate-spin" /> : null} Déconnecter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function BankConnections({ companyId, connections, canWrite }: { companyId: string; connections: BankConnectionView[]; canWrite: boolean }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Synchronisation bancaire</CardTitle>
        <CardDescription>
          Vos opérations sont récupérées automatiquement par Bridge, prestataire d'agrégation agréé au titre de la DSP2. Vous vous authentifiez auprès de votre banque sur les pages de Bridge : ComptaPro Digital ne voit ni ne conserve
          jamais vos identifiants bancaires.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {connections.length === 0 ? <p className="text-sm text-muted-foreground">Aucune banque connectée.</p> : connections.map((c) => <ConnectionCard key={c.id} companyId={companyId} connection={c} canWrite={canWrite} />)}
        {canWrite ? (
          <div>
            <ConnectBankButton companyId={companyId} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
