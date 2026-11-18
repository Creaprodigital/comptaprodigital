"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalculatorIcon, Loader2Icon, LogOutIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { AssetView } from "@/server/modules/accounting/assets";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";

const ASSET_ACCOUNTS = [
  ["205000", "Logiciels, licences"],
  ["213100", "Bâtiments"],
  ["215400", "Matériel industriel"],
  ["218100", "Installations, agencements"],
  ["218200", "Matériel de transport"],
  ["218300", "Matériel de bureau et informatique"],
  ["218400", "Mobilier"],
] as const;

function AssetDialog({ companyId, asset, today, open, onOpenChange }: { companyId: string; asset?: AssetView | null; today: string; open: boolean; onOpenChange: (open: boolean) => void }) {
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
      const saved = asset
        ? await api<AssetView>(`/companies/${companyId}/accounting/assets/${asset.id}`, { method: "PUT", body })
        : await api<AssetView>(`/companies/${companyId}/accounting/assets`, { method: "POST", body });
      toast.success(asset ? "Immobilisation enregistrée." : "Immobilisation inscrite au registre.");
      onOpenChange(false);
      if (asset) router.refresh();
      else router.push(`/app/comptabilite/immobilisations/${saved.id}`);
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
          <DialogTitle>{asset ? "Modifier l'immobilisation" : "Nouvelle immobilisation"}</DialogTitle>
          <DialogDescription>Le plan d'amortissement est calculé automatiquement. L'achat lui-même est comptabilisé par la facture d'achat ou l'opération bancaire, classée dans le compte d'immobilisation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={asset?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="asset-label" label="Désignation" error={errors.label} required className="sm:col-span-2">
              <Input name="label" required maxLength={191} defaultValue={asset?.label ?? ""} />
            </Field>
            <Field id="asset-account" label="Compte d'immobilisation" error={errors.assetAccountNumber} required>
              <NativeSelect name="assetAccountNumber" defaultValue={asset?.assetAccountNumber ?? "218300"}>
                {ASSET_ACCOUNTS.map(([n, l]) => <option key={n} value={n}>{n} — {l}</option>)}
              </NativeSelect>
            </Field>
            <Field id="asset-cost" label="Valeur d'acquisition HT" error={errors.cost} required>
              <Input name="cost" inputMode="decimal" required defaultValue={asset?.cost.replace(".", ",") ?? ""} />
            </Field>
            <Field id="asset-acquisition" label="Date d'acquisition" error={errors.acquisitionDate} required>
              <Input name="acquisitionDate" type="date" required max={today} defaultValue={asset?.acquisitionDate ?? today} />
            </Field>
            <Field id="asset-service" label="Mise en service" error={errors.serviceDate} required>
              <Input name="serviceDate" type="date" required defaultValue={asset?.serviceDate ?? today} />
            </Field>
            <Field id="asset-method" label="Mode d'amortissement" error={errors.method}>
              <NativeSelect name="method" defaultValue={asset?.method ?? "LINEAR"}>
                <option value="LINEAR">Linéaire</option>
                <option value="DECLINING">Dégressif</option>
              </NativeSelect>
            </Field>
            <Field id="asset-duration" label="Durée (mois)" error={errors.durationMonths} required hint="Durée d'usage du bien.">
              <Input name="durationMonths" type="number" min={12} max={600} required defaultValue={asset?.durationMonths ?? 36} />
            </Field>
            <Field id="asset-residual" label="Valeur résiduelle" error={errors.residualValue} hint="Généralement nulle.">
              <Input name="residualValue" inputMode="decimal" defaultValue={asset && Number(asset.residualValue) > 0 ? asset.residualValue.replace(".", ",") : ""} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}{asset ? "Enregistrer" : "Inscrire au registre"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAssetButton({ companyId, today }: { companyId: string; today: string }) {
  const [open, setOpen] = useState(false);
  useResetOnHide(() => setOpen(false));
  return (
    <>
      <Button onClick={() => setOpen(true)}><PlusIcon /> Nouvelle immobilisation</Button>
      <AssetDialog companyId={companyId} today={today} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function PostDepreciationButton({ companyId, fiscalYearId, label }: { companyId: string; fiscalYearId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const result = await api<{ assets: number; total: string }>(`/companies/${companyId}/accounting/fiscal-years/${fiscalYearId}/depreciation`, { method: "POST" });
      toast.success(result.assets > 0 ? `Dotations de l'${label.toLowerCase()} : ${formatCurrency(result.total)} pour ${result.assets} bien${result.assets > 1 ? "s" : ""}, au brouillard.` : "Aucune dotation pour cet exercice.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CalculatorIcon />} Calculer les dotations — {label}
    </Button>
  );
}

export function AssetActions({ companyId, asset, today }: { companyId: string; asset: AssetView; today: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "dispose" | null>(null);
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);
  useResetOnHide(() => setDialog(null));
  if (asset.status === "DISPOSED") return null;
  const locked = asset.recorded.length > 0;

  async function run(action: () => Promise<unknown>, message: string, after?: () => void) {
    setPending(true);
    try {
      await action();
      toast.success(message);
      setDialog(null);
      after?.();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!locked ? <Button variant="outline" onClick={() => setDialog("edit")}><PencilIcon /> Modifier</Button> : null}
      <Button variant="outline" onClick={() => setDialog("dispose")}><LogOutIcon /> Sortir de l'actif</Button>
      {!locked ? (
        <Button variant="ghost" disabled={pending} onClick={() => { if (window.confirm("Retirer ce bien du registre ?")) void run(() => api(`/companies/${companyId}/accounting/assets/${asset.id}`, { method: "DELETE" }), "Immobilisation supprimée.", () => router.push("/app/comptabilite/immobilisations")); }}>
          <Trash2Icon /> Supprimer
        </Button>
      ) : null}
      <AssetDialog companyId={companyId} asset={asset} today={today} open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} />
      <Dialog open={dialog === "dispose"} onOpenChange={(open) => setDialog(open ? "dispose" : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sortie de l'actif</DialogTitle>
            <DialogDescription>Cession ou mise au rebut. La dotation complémentaire jusqu'à la date de sortie et l'écriture de sortie sont préparées au brouillard.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field id="dispose-date" label="Date de sortie" required><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field id="dispose-price" label="Prix de cession HT" hint="Laissez vide pour une mise au rebut."><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
            <Button disabled={pending} onClick={() => run(() => api(`/companies/${companyId}/accounting/assets/${asset.id}/dispose`, { method: "POST", body: { date, salePrice: price } }), "Sortie de l'actif enregistrée.")}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null} Confirmer la sortie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
