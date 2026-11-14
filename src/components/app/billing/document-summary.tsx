import { formatCurrency } from "@/lib/format";
import type { ItemView } from "@/server/modules/invoicing/shared";

type Totals = {
  subtotalExclTax: string;
  discountAmount: string;
  totalExclTax: string;
  vatBreakdown: Array<{ rate: string; base: string; vat: string }>;
  totalInclTax: string;
  amountPaid?: string;
  creditedAmount?: string;
  remaining?: string;
};

const percent = (value: string) => `${Number(value).toLocaleString("fr-FR")} %`;
const quantity = (value: string) => Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 4 });

/** Lignes et totaux d'un devis ou d'une facture, tels qu'ils figurent sur le document. */
export function DocumentLines({ items, totals, currency }: { items: ItemView[]; totals: Totals; currency: string }) {
  const money = (value: string) => formatCurrency(value, { currency });
  const hasLineDiscount = items.some((item) => Number(item.discountRate) > 0);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="py-2 pr-4 font-medium">Désignation</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Qté</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">PU HT</th>
              {hasLineDiscount ? <th scope="col" className="px-2 py-2 text-right font-medium">Remise</th> : null}
              <th scope="col" className="px-2 py-2 text-right font-medium">TVA</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b align-top last:border-0">
                <td className="py-3 pr-4 whitespace-pre-line">{item.description}</td>
                <td className="tabular px-2 py-3 text-right whitespace-nowrap">
                  {quantity(item.quantity)}
                  {item.unit ? <span className="text-muted-foreground"> {item.unit}</span> : null}
                </td>
                <td className="tabular px-2 py-3 text-right whitespace-nowrap">{money(item.unitPriceExclTax)}</td>
                {hasLineDiscount ? <td className="tabular px-2 py-3 text-right">{Number(item.discountRate) > 0 ? percent(item.discountRate) : "—"}</td> : null}
                <td className="tabular px-2 py-3 text-right">{percent(item.vatRate)}</td>
                <td className="tabular py-3 pl-2 text-right font-medium whitespace-nowrap">{money(item.totalExclTax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 ml-auto grid w-full max-w-xs gap-1.5 text-sm">
        {Number(totals.discountAmount) > 0 ? (
          <>
            <div className="flex justify-between"><dt className="text-muted-foreground">Sous-total HT</dt><dd className="tabular">{money(totals.subtotalExclTax)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Remise</dt><dd className="tabular">− {money(totals.discountAmount)}</dd></div>
          </>
        ) : null}
        <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="tabular font-medium">{money(totals.totalExclTax)}</dd></div>
        {totals.vatBreakdown.map((row) => (
          <div key={row.rate} className="flex justify-between">
            <dt className="text-muted-foreground">TVA {percent(row.rate)}</dt>
            <dd className="tabular">{money(row.vat)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t pt-2 text-base">
          <dt className="font-semibold">Total TTC</dt>
          <dd className="tabular font-display font-bold">{money(totals.totalInclTax)}</dd>
        </div>
        {totals.remaining !== undefined ? (
          <>
            {Number(totals.amountPaid) > 0 ? <div className="flex justify-between"><dt className="text-muted-foreground">Déjà réglé</dt><dd className="tabular">− {money(totals.amountPaid!)}</dd></div> : null}
            {Number(totals.creditedAmount) > 0 ? <div className="flex justify-between"><dt className="text-muted-foreground">Avoirs</dt><dd className="tabular">− {money(totals.creditedAmount!)}</dd></div> : null}
            <div className="flex justify-between font-semibold"><dt>Reste à encaisser</dt><dd className="tabular">{money(totals.remaining)}</dd></div>
          </>
        ) : null}
      </dl>
    </div>
  );
}
