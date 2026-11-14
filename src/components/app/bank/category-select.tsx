import { CATEGORY_KIND_LABELS, CATEGORY_KINDS } from "@/lib/bank";
import type { CategoryView } from "@/server/modules/bank/categories";
import { NativeSelect } from "@/components/ui/input";

/** Liste des catégories, regroupées par nature. */
export function CategorySelect({ categories, emptyLabel, ...props }: { categories: CategoryView[]; emptyLabel?: string } & React.ComponentProps<"select">) {
  return (
    <NativeSelect {...props}>
      {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
      {CATEGORY_KINDS.map((kind) => {
        const items = categories.filter((c) => c.kind === kind);
        if (items.length === 0) return null;
        return (
          <optgroup key={kind} label={CATEGORY_KIND_LABELS[kind]}>
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </NativeSelect>
  );
}

export function VatRateSelect({ emptyLabel = "Sans TVA déductible", ...props }: { emptyLabel?: string } & React.ComponentProps<"select">) {
  return (
    <NativeSelect {...props}>
      <option value="">{emptyLabel}</option>
      <option value="20">20 %</option>
      <option value="10">10 %</option>
      <option value="5.5">5,5 %</option>
      <option value="2.1">2,1 %</option>
    </NativeSelect>
  );
}
