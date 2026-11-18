"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, ClipboardCheckIcon, FileCheck2Icon, Loader2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type Status = "NOT_STARTED" | "OPEN" | "PREPARED" | "VALIDATED" | "DECLARED";

const CONFIRMS = {
  prepare: null,
  validate: "Valider cette déclaration ? Ses montants sont figés et l'écriture de liquidation de la TVA est préparée en comptabilité. Rien n'est transmis à l'administration : vous déposez vous-même la déclaration sur votre espace professionnel.",
  declare: "Confirmez-vous avoir déposé cette déclaration sur votre espace professionnel impots.gouv.fr ?",
  reopen: "Rouvrir cette déclaration ? Elle repasse en préparation et l'écriture de liquidation est retirée (contre-passée si elle a été validée).",
} as const;

const MESSAGES = { prepare: "Déclaration préparée : vérifiez-la avant de la valider.", validate: "Déclaration validée.", declare: "Dépôt de la déclaration enregistré.", reopen: "Déclaration rouverte." } as const;

export function VatPeriodActions({ companyId, startDate, status, ended, canWrite, canValidate }: { companyId: string; startDate: string; status: Status; ended: boolean; canWrite: boolean; canValidate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<keyof typeof CONFIRMS | null>(null);

  async function run(action: keyof typeof CONFIRMS) {
    const confirm = CONFIRMS[action];
    if (confirm && !window.confirm(confirm)) return;
    setBusy(action);
    try {
      await api(`/companies/${companyId}/vat/periods/${startDate}`, { method: "POST", body: { action } });
      toast.success(MESSAGES[action]);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  const spinner = (action: keyof typeof CONFIRMS) => (busy === action ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null);

  return (
    <div className="flex flex-wrap gap-2">
      {canWrite && ended && (status === "NOT_STARTED" || status === "OPEN" || status === "PREPARED") ? (
        <Button variant={status === "PREPARED" ? "outline" : "default"} disabled={busy !== null} onClick={() => run("prepare")}>
          {spinner("prepare") ?? <ClipboardCheckIcon />} {status === "PREPARED" ? "Recalculer" : "Préparer la déclaration"}
        </Button>
      ) : null}
      {canValidate && status === "PREPARED" ? (
        <Button disabled={busy !== null} onClick={() => run("validate")}>
          {spinner("validate") ?? <CheckIcon />} Valider la déclaration
        </Button>
      ) : null}
      {canValidate && status === "VALIDATED" ? (
        <>
          <Button disabled={busy !== null} onClick={() => run("declare")}>
            {spinner("declare") ?? <FileCheck2Icon />} J'ai déposé la déclaration
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => run("reopen")}>
            {spinner("reopen") ?? <Undo2Icon />} Rouvrir
          </Button>
        </>
      ) : null}
    </div>
  );
}
