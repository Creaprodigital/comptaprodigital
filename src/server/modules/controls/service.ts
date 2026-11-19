import Decimal from "decimal.js";
import type { CompanyAccess } from "@/server/rbac/service";
import { companyHasModule } from "@/server/modules/plans/service";
import { fromIsoDate, todayInParis, toIsoDate } from "@/lib/dates";

/**
 * Contrôles automatiques, déterministes (sans IA) : ils signalent, ne corrigent rien.
 * Chaque contrôle n'est exécuté que si le rôle de l'utilisateur et la formule donnent
 * accès aux données concernées.
 */

export type ControlItem = { label: string; date?: string; amount?: string; href: string };
export type ControlFinding = {
  code: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
  count: number;
  items: ControlItem[];
};

const MAX_ITEMS = 20;
const STANDARD_VAT_RATES = ["0", "2.1", "5.5", "10", "20"].map((r) => new Decimal(r));

const daysAgo = (n: number) => fromIsoDate(toIsoDate(new Date(Date.now() - n * 86400_000)));
const money = (value: Decimal.Value) => new Decimal(value).toFixed(2);

function median(values: Decimal[]): Decimal {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).dividedBy(2);
}

/** Taux de TVA apparent d'un achat cohérent avec un taux français (ou un mélange plausible de taux). Exporté pour les tests. */
export function plausibleVat(totalExclTax: Decimal.Value, totalVat: Decimal.Value): boolean {
  const ht = new Decimal(totalExclTax);
  const vat = new Decimal(totalVat);
  if (ht.lte(0) || vat.isZero()) return true;
  const rate = vat.dividedBy(ht).times(100);
  // Tolérance d'arrondi : 2 centimes rapportés au montant, et au moins 0,05 point.
  const tolerance = Decimal.max(new Decimal("0.05"), new Decimal("0.02").dividedBy(ht).times(100));
  if (STANDARD_VAT_RATES.some((r) => rate.minus(r).abs().lte(tolerance))) return true;
  // Un taux compris entre 2,1 % et 20 % peut résulter de plusieurs taux sur une même facture.
  return rate.gt(2.1) && rate.lt(20);
}

export async function runControls(access: CompanyAccess): Promise<ControlFinding[]> {
  const companyId = access.company.id;
  const can = (p: string) => access.permissions.has(p);
  const [bank, documents] = await Promise.all([companyHasModule(companyId, "bank"), companyHasModule(companyId, "documents")]);
  const findings: ControlFinding[] = [];

  if (bank && can("bank:read")) {
    const [duplicates, missing, uncategorized] = await Promise.all([
      access.db.bankTransaction.findMany({ where: { isDuplicateSuspect: true }, select: { id: true, date: true, label: true, amount: true }, orderBy: { date: "desc" } }),
      documents
        ? access.db.bankTransaction.findMany({
            where: { amount: { lt: 0 }, documentCount: 0, purchaseId: null, date: { lte: daysAgo(7) } },
            select: { id: true, date: true, label: true, amount: true, category: { select: { name: true, accountNumber: true } } },
            orderBy: { amount: "asc" },
          })
        : Promise.resolve([]),
      access.db.bankTransaction.findMany({ where: { categoryId: null, date: { lte: daysAgo(30) } }, select: { id: true, date: true, label: true, amount: true }, orderBy: { date: "asc" } }),
    ]);
    if (duplicates.length) {
      findings.push({
        code: "BANK_DUPLICATES",
        severity: "warning",
        title: "Opérations bancaires en double possible",
        detail: "Même date, même montant et même libellé qu'une autre opération : vérifiez qu'il ne s'agit pas d'un relevé importé deux fois.",
        count: duplicates.length,
        items: duplicates.slice(0, MAX_ITEMS).map((t) => ({ label: t.label, date: toIsoDate(t.date), amount: money(t.amount), href: `/app/banque/operations/${t.id}` })),
      });
    }
    // Les salaires, impôts et cotisations n'ont pas de facture : ils restent signalés, la personne juge.
    if (missing.length) {
      const total = missing.reduce((acc, t) => acc.plus(t.amount), new Decimal(0));
      findings.push({
        code: "MISSING_RECEIPTS",
        severity: "warning",
        title: "Dépenses sans justificatif",
        detail: `${missing.length} décaissement(s) de plus de 7 jours sans pièce jointe ni facture d'achat associée, pour ${money(total.abs())} € au total.`,
        count: missing.length,
        items: missing.slice(0, MAX_ITEMS).map((t) => ({ label: `${t.label}${t.category ? ` (${t.category.name})` : ""}`, date: toIsoDate(t.date), amount: money(t.amount), href: `/app/banque/operations/${t.id}` })),
      });
    }
    if (uncategorized.length) {
      findings.push({
        code: "UNCATEGORIZED",
        severity: "info",
        title: "Opérations non catégorisées depuis plus de 30 jours",
        detail: "Elles ne sont pas reprises dans les indicateurs par catégorie ni dans les écritures comptables tant qu'elles ne sont pas catégorisées.",
        count: uncategorized.length,
        items: uncategorized.slice(0, MAX_ITEMS).map((t) => ({ label: t.label, date: toIsoDate(t.date), amount: money(t.amount), href: `/app/banque/operations/${t.id}` })),
      });
    }
  }

  if (can("purchases:read")) {
    const purchases = await access.db.purchase.findMany({
      where: { status: { not: "CANCELLED" }, issueDate: { gte: daysAgo(730) } },
      select: { id: true, label: true, reference: true, issueDate: true, totalExclTax: true, totalVat: true, totalInclTax: true, supplierId: true, supplier: { select: { name: true } } },
      orderBy: { issueDate: "asc" },
    });
    const href = (id: string) => `/app/achats/${id}`;
    const name = (p: (typeof purchases)[number]) => `${p.supplier?.name ?? "Sans fournisseur"} — ${p.reference ?? p.label}`;

    // Doublons : même fournisseur, même montant TTC, à moins de 5 jours d'écart.
    const duplicates: ControlItem[] = [];
    let duplicateCount = 0;
    for (let i = 0; i < purchases.length; i++) {
      for (let j = i + 1; j < purchases.length; j++) {
        const a = purchases[i];
        const b = purchases[j];
        if (b.issueDate.getTime() - a.issueDate.getTime() > 5 * 86400_000) break;
        if (a.supplierId && a.supplierId === b.supplierId && new Decimal(a.totalInclTax).equals(b.totalInclTax)) {
          duplicateCount++;
          if (duplicates.length < MAX_ITEMS) duplicates.push({ label: `${name(b)} (même montant que ${a.reference ?? a.label} du ${toIsoDate(a.issueDate)})`, date: toIsoDate(b.issueDate), amount: money(b.totalInclTax), href: href(b.id) });
        }
      }
    }
    if (duplicateCount) {
      findings.push({ code: "PURCHASE_DUPLICATES", severity: "warning", title: "Factures d'achat en double possible", detail: "Même fournisseur et même montant à quelques jours d'intervalle : une facture a peut-être été saisie deux fois.", count: duplicateCount, items: duplicates });
    }

    // TVA incohérente avec les taux français.
    const badVat = purchases.filter((p) => !plausibleVat(p.totalExclTax, p.totalVat));
    if (badVat.length) {
      findings.push({
        code: "VAT_INCONSISTENT",
        severity: "warning",
        title: "TVA déductible inhabituelle",
        detail: "Le rapport entre la TVA et le montant hors taxes ne correspond à aucun taux français : vérifiez la saisie (montant TTC saisi en HT, TVA étrangère non récupérable…).",
        count: badVat.length,
        items: badVat.slice(0, MAX_ITEMS).map((p) => ({ label: `${name(p)} — ${new Decimal(p.totalVat).dividedBy(p.totalExclTax).times(100).toFixed(1)} %`, date: toIsoDate(p.issueDate), amount: money(p.totalInclTax), href: href(p.id) })),
      });
    }

    // Montant inhabituel : plus de 3 fois la médiane des factures précédentes du même fournisseur (au moins 3).
    const unusual: ControlItem[] = [];
    const history = new Map<string, Decimal[]>();
    const recent = daysAgo(180);
    for (const p of purchases) {
      if (!p.supplierId) continue;
      const previous = history.get(p.supplierId) ?? [];
      const amount = new Decimal(p.totalExclTax);
      if (previous.length >= 3 && p.issueDate >= recent && amount.gt(median(previous).times(3))) {
        unusual.push({ label: `${name(p)} (habituellement ${money(median(previous))} € HT)`, date: toIsoDate(p.issueDate), amount: money(p.totalInclTax), href: href(p.id) });
      }
      history.set(p.supplierId, [...previous, amount]);
    }
    if (unusual.length) {
      findings.push({ code: "UNUSUAL_AMOUNT", severity: "info", title: "Montants inhabituels", detail: "Factures des 6 derniers mois plus de trois fois supérieures au montant habituel du fournisseur.", count: unusual.length, items: unusual.slice(0, MAX_ITEMS) });
    }
  }

  if (can("invoices:read")) {
    const overdue = await access.db.invoice.findMany({
      where: { type: "INVOICE", status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID"] }, dueDate: { lt: fromIsoDate(todayInParis()) } },
      select: { id: true, number: true, dueDate: true, totalInclTax: true, amountPaid: true, customer: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    });
    if (overdue.length) {
      findings.push({
        code: "OVERDUE_INVOICES",
        severity: "info",
        title: "Factures clients échues non réglées",
        detail: "Une relance peut être envoyée depuis chaque facture.",
        count: overdue.length,
        items: overdue.slice(0, MAX_ITEMS).map((i) => ({ label: `${i.number} — ${i.customer.name}`, date: i.dueDate ? toIsoDate(i.dueDate) : undefined, amount: money(new Decimal(i.totalInclTax).minus(i.amountPaid)), href: `/app/factures/${i.id}` })),
      });
    }
  }
  return findings;
}
