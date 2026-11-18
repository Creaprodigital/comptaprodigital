"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, Ban, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { CategoryView } from "@/server/modules/bank/categories";
import type { PurchaseView, SupplierView } from "@/server/modules/purchases/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PurchaseDialog } from "@/components/app/purchases/purchase-dialog";

export function PurchaseStatusBadge({ purchase }: { purchase: Pick<PurchaseView, "status" | "overdue" | "amountPaid"> }) {
  if (purchase.status === "CANCELLED") return <Badge variant="outline">Annulée</Badge>;
  if (purchase.status === "PAID") return <Badge variant="success">Payée</Badge>;
  if (purchase.overdue) return <Badge variant="destructive">En retard</Badge>;
  if (Number(purchase.amountPaid) > 0) return <Badge variant="warning">Payée partiellement</Badge>;
  return <Badge variant="accent">À payer</Badge>;
}

export function PurchasesTable({ purchases, currency }: { purchases: PurchaseView[]; currency: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Date</TableHead>
          <TableHead>Fournisseur et objet</TableHead>
          <TableHead className="hidden lg:table-cell">Catégorie</TableHead>
          <TableHead className="hidden sm:table-cell">Statut</TableHead>
          <TableHead className="text-right">TTC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {purchases.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(p.issueDate)}</TableCell>
            <TableCell className="max-w-[22rem]">
              <Link href={`/app/achats/${p.id}`} className="block truncate font-medium hover:text-primary hover:underline">
                {p.supplier?.name ?? "Sans fournisseur"}
                {p.reference ? ` — ${p.reference}` : ""}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{p.label}</p>
            </TableCell>
            <TableCell className="hidden text-sm lg:table-cell">{p.category?.name ?? "—"}</TableCell>
            <TableCell className="hidden sm:table-cell"><PurchaseStatusBadge purchase={p} /></TableCell>
            <TableCell className="tabular text-right font-semibold">
              {formatCurrency(p.totalInclTax, { currency })}
              {p.status === "TO_PAY" && Number(p.amountPaid) > 0 ? <p className="text-xs font-normal text-muted-foreground">reste {formatCurrency(p.remaining, { currency })}</p> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function NewPurchaseButton(props: { companyId: string; suppliers: SupplierView[]; categories: CategoryView[]; today: string }) {
  const [open, setOpen] = useState(false);
  useResetOnHide(() => setOpen(false));
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Nouvelle facture d'achat
      </Button>
      <PurchaseDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function PurchaseActions({ companyId, purchase, suppliers, categories, today, canWrite }: { companyId: string; purchase: PurchaseView; suppliers: SupplierView[]; categories: CategoryView[]; today: string; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setEditing(false));
  if (!canWrite || purchase.status === "CANCELLED") return null;
  const locked = purchase.payments.length > 0;

  async function cancel() {
    if (!window.confirm("Annuler cette facture d'achat ? Son écriture comptable sera annulée (contre-passée si elle a été validée).")) return;
    setPending(true);
    try {
      await api(`/companies/${companyId}/purchases/${purchase.id}/cancel`, { method: "POST" });
      toast.success("Facture d'achat annulée.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setEditing(true)} disabled={locked} title={locked ? "Retirez d'abord les règlements rapprochés" : undefined}>
        <PencilIcon /> Modifier
      </Button>
      <Button variant="ghost" onClick={cancel} disabled={pending || locked}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <Ban />} Annuler la facture
      </Button>
      <PurchaseDialog companyId={companyId} purchase={purchase} suppliers={suppliers} categories={categories} today={today} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

// --- Fournisseurs -------------------------------------------------------------------------

function SupplierDialog({ companyId, supplier, open, onOpenChange }: { companyId: string; supplier?: SupplierView | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (supplier) await api(`/companies/${companyId}/suppliers/${supplier.id}`, { method: "PUT", body });
      else await api(`/companies/${companyId}/suppliers`, { method: "POST", body });
      toast.success(supplier ? "Fournisseur enregistré." : "Fournisseur ajouté.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{supplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}</DialogTitle>
          <DialogDescription>Un compte auxiliaire lui est attribué à sa première écriture comptable.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={supplier?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="supplier-name" label="Nom ou raison sociale" error={errors.name} required className="sm:col-span-2">
              <Input name="name" required maxLength={191} defaultValue={supplier?.name ?? ""} />
            </Field>
            <Field id="supplier-siren" label="SIREN" error={errors.siren}>
              <Input name="siren" inputMode="numeric" defaultValue={supplier?.siren ?? ""} />
            </Field>
            <Field id="supplier-vat" label="N° de TVA intracommunautaire" error={errors.vatNumber}>
              <Input name="vatNumber" defaultValue={supplier?.vatNumber ?? ""} />
            </Field>
            <Field id="supplier-email" label="Adresse e-mail" error={errors.email}>
              <Input name="email" type="email" defaultValue={supplier?.email ?? ""} />
            </Field>
            <Field id="supplier-phone" label="Téléphone" error={errors.phone}>
              <Input name="phone" type="tel" defaultValue={supplier?.phone ?? ""} />
            </Field>
            <Field id="supplier-address" label="Adresse" error={errors.addressLine1} className="sm:col-span-2">
              <Input name="addressLine1" defaultValue={supplier?.addressLine1 ?? ""} />
            </Field>
            <Field id="supplier-postal" label="Code postal" error={errors.postalCode}>
              <Input name="postalCode" defaultValue={supplier?.postalCode ?? ""} />
            </Field>
            <Field id="supplier-city" label="Ville" error={errors.city}>
              <Input name="city" defaultValue={supplier?.city ?? ""} />
            </Field>
            <Field id="supplier-notes" label="Notes internes" error={errors.notes} className="sm:col-span-2">
              <Textarea name="notes" rows={2} className="min-h-16" defaultValue={supplier?.notes ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {supplier ? "Enregistrer" : "Ajouter le fournisseur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SuppliersPanel({ companyId, suppliers, canWrite, currency }: { companyId: string; suppliers: SupplierView[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ supplier: SupplierView | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => setDialog(null));

  async function archive(supplier: SupplierView) {
    setBusy(supplier.id);
    try {
      await api(`/companies/${companyId}/suppliers/${supplier.id}/archive`, { method: "POST", body: { archived: !supplier.archived } });
      toast.success(supplier.archived ? "Fournisseur réactivé." : "Fournisseur archivé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canWrite ? (
        <Button className="mb-3" onClick={() => setDialog({ supplier: null })}>
          <PlusIcon /> Nouveau fournisseur
        </Button>
      ) : null}
      {suppliers.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Aucun fournisseur.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fournisseur</TableHead>
              <TableHead className="hidden md:table-cell">Compte</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Factures</TableHead>
              <TableHead className="text-right">Reste à payer</TableHead>
              {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/app/achats?fournisseur=${s.id}`} className="font-medium hover:text-primary hover:underline">{s.name}</Link>
                  <p className="text-xs text-muted-foreground">{[s.city, s.siren ? `SIREN ${s.siren}` : null].filter(Boolean).join(" · ")}</p>
                </TableCell>
                <TableCell className="tabular hidden text-muted-foreground md:table-cell">{s.accountNumber ?? "—"}</TableCell>
                <TableCell className="tabular hidden text-right sm:table-cell">{s.purchaseCount}</TableCell>
                <TableCell className="tabular text-right font-medium">{Number(s.outstanding) > 0 ? formatCurrency(s.outstanding, { currency }) : "—"}</TableCell>
                {canWrite ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ supplier: s })} aria-label={`Modifier ${s.name}`}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" disabled={busy === s.id} onClick={() => archive(s)} aria-label={s.archived ? `Réactiver ${s.name}` : `Archiver ${s.name}`}>
                      {s.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <SupplierDialog companyId={companyId} supplier={dialog?.supplier} open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} />
    </>
  );
}
