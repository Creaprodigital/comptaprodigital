"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { CustomerView } from "@/server/modules/customers/service";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatSiren } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerDialog } from "@/components/app/billing/customer-dialog";

type Row = CustomerView & { outstanding: string };

export function CustomersTable({ companyId, customers, canWrite, currency }: { companyId: string; customers: Row[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomerView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function archive(customer: CustomerView, archived: boolean) {
    setBusy(customer.id);
    try {
      await api(`/companies/${companyId}/customers/${customer.id}/archive`, { method: "POST", body: { archived } });
      toast.success(archived ? "Client archivé." : "Client réactivé.");
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
            <TableHead>Client</TableHead>
            <TableHead className="hidden md:table-cell">Contact</TableHead>
            <TableHead className="hidden lg:table-cell">Ville</TableHead>
            <TableHead className="text-right">Encours</TableHead>
            {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell>
                <p className="font-medium">{customer.name}</p>
                <p className="text-xs text-muted-foreground">
                  {customer.type === "INDIVIDUAL" ? "Particulier" : customer.siren ? `SIREN ${formatSiren(customer.siren)}` : "Professionnel"}
                  {customer.archived ? <Badge variant="outline" className="ml-2">Archivé</Badge> : null}
                </p>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <p>{customer.contactName ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{customer.email ?? ""}</p>
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{customer.city ?? "—"}</TableCell>
              <TableCell className="tabular text-right font-medium">{Number(customer.outstanding) > 0 ? formatCurrency(customer.outstanding, { currency }) : "—"}</TableCell>
              {canWrite ? (
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(customer)} aria-label={`Modifier ${customer.name}`}>
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy === customer.id}
                    onClick={() => archive(customer, !customer.archived)}
                    aria-label={customer.archived ? `Réactiver ${customer.name}` : `Archiver ${customer.name}`}
                  >
                    {customer.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CustomerDialog
        companyId={companyId}
        customer={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          toast.success("Client enregistré.");
          router.refresh();
        }}
      />
    </>
  );
}

export function NewCustomerButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Nouveau client
      </Button>
      <CustomerDialog
        companyId={companyId}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          toast.success("Client créé.");
          router.refresh();
        }}
      />
    </>
  );
}
