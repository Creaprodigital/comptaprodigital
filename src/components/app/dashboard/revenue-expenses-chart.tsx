"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortMonthLabel } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";

type Point = { month: string; revenue: string; expenses: string };

const SERIES = [
  { key: "revenue", label: "Recettes (HT)", color: "var(--chart-revenue)" },
  { key: "expenses", label: "Dépenses (HT)", color: "var(--chart-expenses)" },
] as const;

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string }>;
  label?: string | number;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((item) => [String(item.dataKey), Number(item.value ?? 0)]));
  const result = (values.revenue ?? 0) - (values.expenses ?? 0);
  return (
    <div className="min-w-44 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-elevated">
      <p className="font-semibold capitalize">{shortMonthLabel(String(label))}</p>
      <dl className="mt-2 grid gap-1.5">
        {SERIES.map((series) => (
          <div key={series.key} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2.5 rounded-[3px]" style={{ background: series.color }} aria-hidden="true" />
              {series.label}
            </dt>
            <dd className="tabular font-medium">{formatCurrency(values[series.key] ?? 0, { currency })}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-6 border-t pt-1.5">
          <dt className="text-muted-foreground">Écart</dt>
          <dd className="tabular font-semibold">{formatCurrency(result, { currency })}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Évolution mensuelle des recettes et des dépenses : barres groupées sur un seul
 * axe, légende toujours visible, info-bulle au survol et tableau de données en repli.
 */
export function RevenueExpensesChart({ data, currency }: { data: Point[]; currency: string }) {
  // Conversion en nombres pour le seul tracé : aucun calcul comptable n'est fait ici.
  const points = data.map((point) => ({ month: point.month, revenue: Number(point.revenue), expenses: Number(point.expenses) }));

  return (
    <div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground" aria-label="Légende">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
          </li>
        ))}
      </ul>

      <div className="mt-4 h-72 w-full" role="img" aria-label="Graphique en barres des recettes et dépenses mensuelles sur douze mois">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonthLabel}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(value: number) => formatCurrency(value, { currency, compact: true })}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip currency={currency} />} />
            {SERIES.map((series) => (
              <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary underline-offset-4 hover:underline">Afficher les données en tableau</summary>
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-2 font-medium">Mois</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Recettes (HT)</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Dépenses (HT)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.month} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal capitalize">{shortMonthLabel(point.month)}</th>
                  <td className="tabular px-4 py-2 text-right">{formatCurrency(point.revenue, { currency })}</td>
                  <td className="tabular px-4 py-2 text-right">{formatCurrency(point.expenses, { currency })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
