"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortMonthLabel } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";

/** Encaissements mensuels des abonnements (une série, une couleur, tableau de données en repli). */
export function RevenueChart({ data }: { data: Array<{ month: string; revenue: string }> }) {
  // Conversion en nombres pour le seul tracé.
  const points = data.map((p) => ({ month: p.month, revenue: Number(p.revenue) }));
  return (
    <div>
      <div className="h-64 w-full" role="img" aria-label="Graphique en barres des encaissements mensuels d'abonnements sur douze mois">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="month" tickFormatter={shortMonthLabel} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickFormatter={(v: number) => formatCurrency(v, { compact: true })} tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              formatter={(value) => [formatCurrency(Number(value)), "Encaissé"]}
              labelFormatter={(label) => shortMonthLabel(String(label))}
              contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
            />
            <Bar dataKey="revenue" fill="var(--chart-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Voir les données</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-medium">Mois</th>
              <th className="py-1 text-right font-medium">Encaissé</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.month} className="border-t">
                <td className="py-1 capitalize">{shortMonthLabel(p.month)}</td>
                <td className="py-1 text-right tabular-nums">{formatCurrency(p.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
