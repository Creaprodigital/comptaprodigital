import { ArrowUpRightIcon, BellIcon, LandmarkIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import { LogoMark } from "@/components/logo";

/**
 * Aperçu illustratif du tableau de bord pour la page d'accueil.
 * Les valeurs sont fictives et signalées comme telles ; le véritable tableau
 * de bord n'affiche que les données de l'entreprise connectée.
 */

const bars = [
  { month: "Juin", revenue: 52, expenses: 31 },
  { month: "Juil.", revenue: 64, expenses: 36 },
  { month: "Août", revenue: 41, expenses: 29 },
  { month: "Sept.", revenue: 73, expenses: 38 },
  { month: "Oct.", revenue: 68, expenses: 42 },
  { month: "Nov.", revenue: 88, expenses: 40 },
];

const kpis = [
  { label: "Chiffre d'affaires du mois", value: "18 420 €", icon: ReceiptTextIcon, hint: "+12 % vs mois dernier" },
  { label: "Trésorerie disponible", value: "42 960 €", icon: WalletIcon, hint: "après TVA et dettes fournisseurs" },
  { label: "Solde bancaire", value: "51 310 €", icon: LandmarkIcon, hint: "2 comptes" },
];

export function DashboardPreview() {
  return (
    <figure
      className="relative mx-auto w-full max-w-5xl animate-fade-up rounded-2xl border border-white/10 bg-[#0e1627] p-2 shadow-[0_40px_120px_-30px_rgba(37,99,235,0.55)]"
      aria-label="Aperçu du tableau de bord ComptaPro Digital, avec des données d'illustration"
    >
      <div className="flex overflow-hidden rounded-xl bg-slate-50 text-[#14213D]">
        {/* Barre latérale */}
        <div className="hidden w-44 shrink-0 flex-col gap-1 bg-[#14213D] p-3 text-[11px] text-slate-300 sm:flex">
          <div className="mb-3 flex items-center gap-2 px-1.5 py-1">
            <LogoMark className="size-6" />
            <span className="font-display text-xs font-bold text-white">ComptaPro</span>
          </div>
          {["Tableau de bord", "Facturation", "Banque", "Comptabilité", "TVA", "Documents"].map((item, index) => (
            <span
              key={item}
              className={index === 0 ? "rounded-md bg-white/10 px-2 py-1.5 font-medium text-white" : "px-2 py-1.5"}
            >
              {item}
            </span>
          ))}
        </div>

        {/* Contenu */}
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-sm font-bold sm:text-base">Tableau de bord</p>
              <p className="text-[11px] text-slate-500">Exercice en cours · 30 derniers jours</p>
            </div>
            <span className="flex size-7 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
              <BellIcon className="size-3.5" />
            </span>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>{kpi.label}</span>
                  <kpi.icon className="size-3.5 text-[#2563EB]" />
                </div>
                <p className="tabular mt-1.5 font-display text-lg font-bold">{kpi.value}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700">
                  <ArrowUpRightIcon className="size-3" />
                  {kpi.hint}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold">Recettes et dépenses</span>
                <span className="flex items-center gap-3 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#2563EB]" />Recettes</span>
                  <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#eb6834]" />Dépenses</span>
                </span>
              </div>
              <div className="mt-3 flex h-28 items-end justify-between gap-2 border-b border-slate-200 sm:h-32">
                {bars.map((bar) => (
                  <div key={bar.month} className="flex h-full flex-1 items-end justify-center gap-[2px]">
                    <span className="w-2.5 rounded-t-[3px] bg-[#2563EB] sm:w-3.5" style={{ height: `${bar.revenue}%` }} />
                    <span className="w-2.5 rounded-t-[3px] bg-[#eb6834] sm:w-3.5" style={{ height: `${bar.expenses}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between gap-2 text-[9px] text-slate-500">
                {bars.map((bar) => (
                  <span key={bar.month} className="flex-1 text-center">{bar.month}</span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold">Alertes et échéances</p>
              <ul className="mt-2.5 grid gap-2 text-[10.5px] leading-snug">
                <li className="rounded-lg bg-red-50 px-2.5 py-2 text-red-800">2 factures en retard · 3 240 €</li>
                <li className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">Déclaration de TVA à préparer</li>
                <li className="rounded-lg bg-blue-50 px-2.5 py-2 text-blue-800">5 opérations à catégoriser</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="px-3 pt-2.5 pb-1 text-center text-[11px] text-slate-400">
        Aperçu de l'interface — données d'illustration.
      </figcaption>
    </figure>
  );
}
