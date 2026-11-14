"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { ProductView, VatRateView } from "@/server/modules/products/service";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ProductDialog({
  companyId,
  product,
  vatRates,
  open,
  onOpenChange,
}: {
  companyId: string;
  product?: ProductView | null;
  vatRates: VatRateView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const defaultRate = product?.vatRate ?? vatRates.find((r) => r.isDefault)?.rate ?? vatRates[0]?.rate ?? "0.00";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(event.currentTarget).entries()), isActive: product?.isActive ?? true };
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (product) await api(`/companies/${companyId}/products/${product.id}`, { method: "PATCH", body });
      else await api(`/companies/${companyId}/products`, { method: "POST", body });
      toast.success(product ? "Article enregistré." : "Article créé.");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Modifier l'article" : "Nouvel article"}</DialogTitle>
          <DialogDescription>Produit ou prestation réutilisable dans vos devis et factures.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={product?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="product-name" label="Désignation" error={errors.name} required className="sm:col-span-2">
              <Input name="name" defaultValue={product?.name ?? ""} required autoFocus />
            </Field>
            <Field id="product-type" label="Nature" error={errors.type}>
              <NativeSelect name="type" defaultValue={product?.type ?? "SERVICE"}>
                <option value="SERVICE">Prestation de services</option>
                <option value="GOOD">Bien</option>
              </NativeSelect>
            </Field>
            <Field id="product-reference" label="Référence" error={errors.reference}>
              <Input name="reference" defaultValue={product?.reference ?? ""} />
            </Field>
            <Field id="product-price" label="Prix unitaire HT" error={errors.unitPriceExclTax} required>
              <Input name="unitPriceExclTax" inputMode="decimal" defaultValue={product?.unitPriceExclTax.replace(".", ",") ?? ""} required />
            </Field>
            <Field id="product-unit" label="Unité" error={errors.unit} hint="Ex. heure, jour, forfait, pièce">
              <Input name="unit" defaultValue={product?.unit ?? ""} />
            </Field>
            <Field id="product-vat" label="Taux de TVA" error={errors.vatRate} required>
              <NativeSelect name="vatRate" defaultValue={defaultRate}>
                {vatRates.map((rate) => (
                  <option key={rate.id} value={rate.rate}>{rate.label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="product-description" label="Description" error={errors.description} className="sm:col-span-2" hint="Reprise comme désignation de la ligne.">
              <Textarea name="description" rows={2} className="min-h-16" defaultValue={product?.description ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {product ? "Enregistrer" : "Créer l'article"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewProductButton({ companyId, vatRates }: { companyId: string; vatRates: VatRateView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Nouvel article
      </Button>
      <ProductDialog companyId={companyId} vatRates={vatRates} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ProductsTable({ companyId, products, vatRates, canWrite, currency }: { companyId: string; products: ProductView[]; vatRates: VatRateView[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function archive(product: ProductView, archived: boolean) {
    setBusy(product.id);
    try {
      await api(`/companies/${companyId}/products/${product.id}/archive`, { method: "POST", body: { archived } });
      toast.success(archived ? "Article archivé." : "Article réactivé.");
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
            <TableHead>Désignation</TableHead>
            <TableHead className="hidden md:table-cell">Nature</TableHead>
            <TableHead className="text-right">Prix unitaire HT</TableHead>
            <TableHead className="text-right">TVA</TableHead>
            {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>
                <p className="font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {product.reference ? `Réf. ${product.reference}` : ""}
                  {!product.isActive ? <Badge variant="outline" className="ml-2">Archivé</Badge> : null}
                </p>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{product.type === "SERVICE" ? "Prestation" : "Bien"}</TableCell>
              <TableCell className="tabular text-right font-medium">
                {formatCurrency(product.unitPriceExclTax, { currency })}
                {product.unit ? <span className="text-xs font-normal text-muted-foreground"> / {product.unit}</span> : null}
              </TableCell>
              <TableCell className="tabular text-right">{Number(product.vatRate).toLocaleString("fr-FR")} %</TableCell>
              {canWrite ? (
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(product)} aria-label={`Modifier ${product.name}`}>
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy === product.id}
                    onClick={() => archive(product, product.isActive)}
                    aria-label={product.isActive ? `Archiver ${product.name}` : `Réactiver ${product.name}`}
                  >
                    {product.isActive ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ProductDialog companyId={companyId} product={editing} vatRates={vatRates} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  );
}
