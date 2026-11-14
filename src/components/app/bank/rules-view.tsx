"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { CategoryView, RuleView } from "@/server/modules/bank/categories";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { CATEGORY_KIND_LABELS, CATEGORY_KINDS, RULE_MATCH_LABELS, RULE_MATCH_TYPES } from "@/lib/bank";
import { formatCurrency } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategorySelect, VatRateSelect } from "@/components/app/bank/category-select";
import { CategoryChip } from "@/components/app/bank/shared";

function useSubmit(onDone: () => void) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  async function submit(action: () => Promise<unknown>, message: string) {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await action();
      toast.success(message);
      onDone();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return { pending, errors, formError, submit };
}

function describeRule(rule: RuleView, currency: string): string {
  const parts = [`Le libellé ${RULE_MATCH_LABELS[rule.matchType as keyof typeof RULE_MATCH_LABELS] ?? "correspond à"} « ${rule.pattern} »`];
  if (rule.direction) parts.push(rule.direction === "IN" ? "encaissements" : "décaissements");
  if (rule.amountMin && rule.amountMax) parts.push(`de ${formatCurrency(rule.amountMin, { currency })} à ${formatCurrency(rule.amountMax, { currency })}`);
  else if (rule.amountMin) parts.push(`à partir de ${formatCurrency(rule.amountMin, { currency })}`);
  else if (rule.amountMax) parts.push(`jusqu'à ${formatCurrency(rule.amountMax, { currency })}`);
  return parts.join(" · ");
}

function RuleDialog({ companyId, rule, categories, open, onOpenChange }: { companyId: string; rule?: RuleView | null; categories: CategoryView[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, errors, formError, submit } = useSubmit(() => onOpenChange(false));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { ...Object.fromEntries(form.entries()), isActive: form.get("isActive") === "on" };
    void submit(() => (rule ? api(`/companies/${companyId}/bank/rules/${rule.id}`, { method: "PUT", body }) : api(`/companies/${companyId}/bank/rules`, { method: "POST", body })), rule ? "Règle enregistrée." : "Règle créée.");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Modifier la règle" : "Nouvelle règle de catégorisation"}</DialogTitle>
          <DialogDescription>Une règle s'applique aux opérations importées qui n'ont pas encore de catégorie. Elle ne modifie jamais une opération déjà catégorisée.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={rule?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rule-name" label="Nom de la règle" error={errors.name} required className="sm:col-span-2">
              <Input name="name" required maxLength={100} defaultValue={rule?.name ?? ""} placeholder="Abonnement téléphonique" />
            </Field>
            <Field id="rule-match" label="Le libellé" error={errors.matchType} required>
              <NativeSelect name="matchType" defaultValue={rule && rule.matchType !== "REGEX" ? rule.matchType : "CONTAINS"}>
                {RULE_MATCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {RULE_MATCH_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="rule-pattern" label="Texte recherché" error={errors.pattern} required hint="Sans tenir compte des majuscules ni des accents.">
              <Input name="pattern" required maxLength={255} defaultValue={rule?.pattern ?? ""} placeholder="OPERATEUR TELECOM" />
            </Field>
            <Field id="rule-direction" label="Sens" error={errors.direction}>
              <NativeSelect name="direction" defaultValue={rule?.direction ?? ""}>
                <option value="">Entrées et sorties</option>
                <option value="OUT">Décaissements uniquement</option>
                <option value="IN">Encaissements uniquement</option>
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="rule-min" label="Montant minimal" error={errors.amountMin}>
                <Input name="amountMin" inputMode="decimal" defaultValue={rule?.amountMin?.replace(".", ",") ?? ""} />
              </Field>
              <Field id="rule-max" label="Montant maximal" error={errors.amountMax}>
                <Input name="amountMax" inputMode="decimal" defaultValue={rule?.amountMax?.replace(".", ",") ?? ""} />
              </Field>
            </div>
            <Field id="rule-category" label="Catégorie à appliquer" error={errors.categoryId} required>
              <CategorySelect name="categoryId" categories={categories} emptyLabel="Choisir…" required defaultValue={rule?.categoryId ?? ""} />
            </Field>
            <Field id="rule-vat" label="TVA" error={errors.vatRate}>
              <VatRateSelect name="vatRate" defaultValue={rule?.vatRate ?? ""} />
            </Field>
            <Field id="rule-priority" label="Priorité" error={errors.priority} hint="La règle de plus forte priorité l'emporte (0 à 1000).">
              <Input name="priority" type="number" min={0} max={1000} defaultValue={rule?.priority ?? 0} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
              <input type="checkbox" name="isActive" className="size-4 accent-primary" defaultChecked={rule?.isActive ?? true} /> Règle active
            </label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {rule ? "Enregistrer" : "Créer la règle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel({ companyId, rules, categories, canWrite, currency }: { companyId: string; rules: RuleView[]; categories: CategoryView[]; canWrite: boolean; currency: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ rule: RuleView | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => setDialog(null));

  async function remove(rule: RuleView) {
    if (!window.confirm(`Supprimer la règle « ${rule.name} » ? Les opérations déjà catégorisées ne sont pas modifiées.`)) return;
    setBusy(rule.id);
    try {
      await api(`/companies/${companyId}/bank/rules/${rule.id}`, { method: "DELETE" });
      toast.success("Règle supprimée.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy("apply");
    try {
      const result = await api<{ examined: number; categorized: number }>(`/companies/${companyId}/bank/transactions/apply-rules`, { method: "POST" });
      toast.success(result.categorized > 0 ? `${result.categorized} opération${result.categorized > 1 ? "s" : ""} catégorisée${result.categorized > 1 ? "s" : ""} sur ${result.examined} sans catégorie.` : "Aucune opération sans catégorie ne correspond à vos règles.");
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
        <div className="mb-3 flex flex-wrap gap-2">
          <Button onClick={() => setDialog({ rule: null })}>
            <PlusIcon /> Nouvelle règle
          </Button>
          {rules.some((rule) => rule.isActive) ? (
            <Button variant="outline" onClick={apply} disabled={busy === "apply"}>
              {busy === "apply" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <PlayIcon />} Appliquer aux opérations sans catégorie
            </Button>
          ) : null}
        </div>
      ) : null}
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Aucune règle. Créez-en une pour catégoriser automatiquement vos opérations récurrentes (loyer, abonnements, frais bancaires…).
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Règle</TableHead>
              <TableHead>Catégorie appliquée</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Priorité</TableHead>
              {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  <p className="font-medium">
                    {rule.name} {!rule.isActive ? <Badge variant="outline" className="ml-1">Inactive</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{describeRule(rule, currency)}</p>
                </TableCell>
                <TableCell>
                  <CategoryChip category={{ name: rule.categoryName, color: categories.find((c) => c.id === rule.categoryId)?.color ?? null }} />
                  {rule.vatRate ? <p className="text-xs text-muted-foreground">TVA {rule.vatRate.replace(".", ",")} %</p> : null}
                </TableCell>
                <TableCell className="tabular hidden text-right sm:table-cell">{rule.priority}</TableCell>
                {canWrite ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ rule })} aria-label={`Modifier la règle ${rule.name}`}>
                      <PencilIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={busy === rule.id} onClick={() => remove(rule)} aria-label={`Supprimer la règle ${rule.name}`}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RuleDialog companyId={companyId} rule={dialog?.rule} categories={categories} open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} />
    </>
  );
}

function CategoryDialog({ companyId, category, open, onOpenChange }: { companyId: string; category?: CategoryView | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, errors, formError, submit } = useSubmit(() => onOpenChange(false));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    void submit(
      () => (category ? api(`/companies/${companyId}/bank/categories/${category.id}`, { method: "PUT", body }) : api(`/companies/${companyId}/bank/categories`, { method: "POST", body })),
      category ? "Catégorie enregistrée." : "Catégorie créée.",
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle>
          <DialogDescription>Les catégories propres à votre entreprise complètent les catégories communes.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5" key={category?.id ?? "new"}>
          {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="category-name" label="Nom" error={errors.name} required className="sm:col-span-2">
              <Input name="name" required maxLength={100} defaultValue={category?.name ?? ""} />
            </Field>
            <Field id="category-kind" label="Nature" error={errors.kind} required>
              <NativeSelect name="kind" defaultValue={category?.kind ?? "EXPENSE"}>
                {CATEGORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CATEGORY_KIND_LABELS[kind]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="category-account" label="Compte comptable" error={errors.accountNumber} hint="Facultatif (ex. 613200).">
              <Input name="accountNumber" inputMode="numeric" maxLength={8} defaultValue={category?.accountNumber ?? ""} />
            </Field>
            <Field id="category-color" label="Couleur" error={errors.color}>
              <Input name="color" type="color" defaultValue={category?.color ?? "#2563eb"} className="h-10 w-20 p-1" />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {category ? "Enregistrer" : "Créer la catégorie"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesPanel({ companyId, categories, canWrite }: { companyId: string; categories: CategoryView[]; canWrite: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ category: CategoryView | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => setDialog(null));

  async function remove(category: CategoryView) {
    if (!window.confirm(`Supprimer la catégorie « ${category.name} » ? Si des opérations l'utilisent, elle sera simplement retirée des choix proposés.`)) return;
    setBusy(category.id);
    try {
      const { deleted } = await api<{ deleted: boolean }>(`/companies/${companyId}/bank/categories/${category.id}`, { method: "DELETE" });
      toast.success(deleted ? "Catégorie supprimée." : "Catégorie retirée des choix : les opérations qui l'utilisent la conservent.");
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
        <Button variant="outline" className="mb-3" onClick={() => setDialog({ category: null })}>
          <PlusIcon /> Nouvelle catégorie
        </Button>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {CATEGORY_KINDS.map((kind) => {
          const items = categories.filter((c) => c.kind === kind);
          if (items.length === 0) return null;
          return (
            <section key={kind} aria-label={CATEGORY_KIND_LABELS[kind]}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORY_KIND_LABELS[kind]}</h3>
              <ul className="divide-y rounded-xl border">
                {items.map((category) => (
                  <li key={category.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <CategoryChip category={category} />
                    </div>
                    {category.accountNumber ? <span className="tabular text-xs text-muted-foreground">{category.accountNumber}</span> : null}
                    {category.system ? (
                      <Badge variant="secondary">Commune</Badge>
                    ) : canWrite ? (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ category })} aria-label={`Modifier la catégorie ${category.name}`}>
                          <PencilIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" disabled={busy === category.id} onClick={() => remove(category)} aria-label={`Supprimer la catégorie ${category.name}`}>
                          <Trash2Icon />
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <CategoryDialog companyId={companyId} category={dialog?.category} open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} />
    </>
  );
}
