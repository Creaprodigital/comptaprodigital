"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { RecurringView } from "@/server/modules/invoicing/recurring";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { RECURRENCE_LABELS } from "@/lib/invoicing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS = { ACTIVE: { label: "Active", variant: "success" }, PAUSED: { label: "En pause", variant: "warning" }, ENDED: { label: "Terminée", variant: "secondary" } } as const;

export function RecurringTable({ companyId, items, canManage, currency }: { companyId: string; items: RecurringView[]; canManage: boolean; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RecurringView | null>(null);
  useResetOnHide(() => setToDelete(null));

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setBusy(id);
    try {
      await action();
      toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Récurrence</TableHead>
            <TableHead className="hidden md:table-cell">Périodicité</TableHead>
            <TableHead>Prochaine échéance</TableHead>
            <TableHead className="hidden lg:table-cell">Mode</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Montant TTC</TableHead>
            {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <p className="font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.customerName} · {item.invoiceCount} facture{item.invoiceCount > 1 ? "s" : ""} générée{item.invoiceCount > 1 ? "s" : ""}</p>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{RECURRENCE_LABELS[item.frequency]}</TableCell>
              <TableCell className="whitespace-nowrap">
                {item.status === "ENDED" ? "—" : formatDate(item.nextRunDate)}
                {item.endDate ? <p className="text-xs text-muted-foreground">jusqu'au {formatDate(item.endDate)}</p> : null}
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{item.autoIssue ? (item.autoSend ? "Émission et envoi automatiques" : "Émission automatique") : "Brouillon à valider"}</TableCell>
              <TableCell><Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge></TableCell>
              <TableCell className="tabular text-right font-medium whitespace-nowrap">{formatCurrency(item.totalInclTax, { currency })}</TableCell>
              {canManage ? (
                <TableCell className="text-right whitespace-nowrap">
                  {item.status !== "ENDED" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy === item.id}
                      aria-label={item.status === "ACTIVE" ? `Mettre en pause ${item.label}` : `Reprendre ${item.label}`}
                      onClick={() =>
                        run(
                          item.id,
                          () => api(`/companies/${companyId}/recurring-invoices/${item.id}`, { method: "PATCH", body: { status: item.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } }),
                          item.status === "ACTIVE" ? "Récurrence mise en pause." : "Récurrence reprise.",
                        )
                      }
                    >
                      {item.status === "ACTIVE" ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="icon-sm" onClick={() => setToDelete(item)} aria-label={`Supprimer ${item.label}`}>
                    <Trash2Icon className="text-destructive-foreground" />
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette récurrence ?</DialogTitle>
            <DialogDescription>Plus aucune facture ne sera générée. Les factures déjà créées sont conservées.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={async () => {
                if (!toDelete) return;
                await run(toDelete.id, () => api(`/companies/${companyId}/recurring-invoices/${toDelete.id}`, { method: "DELETE" }), "Récurrence supprimée.");
                setToDelete(null);
              }}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
