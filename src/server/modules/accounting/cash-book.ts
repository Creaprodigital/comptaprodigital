import { csvAmount, toCsv } from "@/server/http/csv";
import type { CompanyAccess } from "@/server/rbac/service";
import { PAYMENT_METHOD_LABELS } from "@/lib/invoicing";
import { dec, sum, toMoneyString } from "@/lib/money";
import { toIsoDate } from "@/lib/dates";

/**
 * Micro-entreprises : livre des recettes (encaissements, dans l'ordre
 * chronologique, avec leur origine et leur mode de règlement) et registre des
 * achats (activités de vente de marchandises). Ils sont tirés des règlements
 * enregistrés sur les factures, des encaissements bancaires classés en produits
 * et des factures d'achat.
 */

export type ReceiptRow = { date: string; reference: string; customer: string; label: string; method: string; amount: string; href: string | null };

export async function receiptsBook(access: CompanyAccess, year: number) {
  const from = new Date(`${year}-01-01T00:00:00Z`);
  const to = new Date(`${year}-12-31T00:00:00Z`);
  const [payments, transactions] = await Promise.all([
    access.db.payment.findMany({ where: { paidAt: { gte: from, lte: to } }, include: { invoice: { select: { id: true, number: true, subject: true, operationCategory: true, customer: { select: { name: true } } } } }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] }),
    // Encaissements bancaires classés en produits et non rattachés à une facture.
    access.db.bankTransaction.findMany({ where: { date: { gte: from, lte: to }, amount: { gt: 0 }, category: { kind: "INCOME" } }, include: { payments: { select: { amount: true } }, category: { select: { name: true } } }, orderBy: { date: "asc" } }),
  ]);
  const rows: ReceiptRow[] = payments.map((p) => ({
    date: toIsoDate(p.paidAt),
    reference: p.invoice.number ?? "",
    customer: p.invoice.customer.name,
    label: p.invoice.subject ?? (p.invoice.operationCategory === "GOODS" ? "Vente de marchandises" : "Prestation de services"),
    method: PAYMENT_METHOD_LABELS[p.method],
    amount: toMoneyString(p.amount),
    href: `/app/factures/${p.invoice.id}`,
  }));
  for (const t of transactions) {
    const remainder = dec(t.amount).minus(sum(t.payments.map((p) => p.amount)));
    if (remainder.lessThanOrEqualTo(0)) continue;
    rows.push({ date: toIsoDate(t.date), reference: t.externalId ?? "", customer: "", label: `${t.label} (${t.category?.name ?? ""})`, method: "Virement ou dépôt bancaire", amount: toMoneyString(remainder), href: `/app/banque/operations/${t.id}` });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month: key, total: toMoneyString(sum(rows.filter((r) => r.date.startsWith(key)).map((r) => r.amount))) };
  });
  return { year, rows, total: toMoneyString(sum(rows.map((r) => r.amount))), byMonth };
}

export async function receiptsBookCsv(access: CompanyAccess, year: number): Promise<string> {
  const book = await receiptsBook(access, year);
  return toCsv(["Date d'encaissement", "Référence de la pièce", "Client", "Nature de la recette", "Mode de règlement", "Montant"], book.rows.map((r) => [r.date, r.reference, r.customer, r.label, r.method, csvAmount(dec(r.amount))]));
}

export async function purchaseRegister(access: CompanyAccess, year: number) {
  const purchases = await access.db.purchase.findMany({
    where: { issueDate: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) }, status: { in: ["TO_PAY", "PAID"] } },
    include: { supplier: { select: { name: true } }, bankTransactions: { select: { date: true } } },
    orderBy: { issueDate: "asc" },
  });
  const rows = purchases.map((p) => ({
    date: toIsoDate(p.issueDate),
    reference: p.reference ?? "",
    supplier: p.supplier?.name ?? "",
    label: p.label,
    amount: toMoneyString(p.totalInclTax),
    paidAt: p.bankTransactions.length ? toIsoDate(p.bankTransactions.map((t) => t.date).sort((a, b) => b.getTime() - a.getTime())[0]) : null,
    method: p.bankTransactions.length ? "Prélèvement, virement ou carte" : p.status === "PAID" ? "Réglée" : "À payer",
    href: `/app/achats/${p.id}`,
  }));
  return { year, rows, total: toMoneyString(sum(rows.map((r) => r.amount))) };
}

export async function purchaseRegisterCsv(access: CompanyAccess, year: number): Promise<string> {
  const register = await purchaseRegister(access, year);
  return toCsv(["Date", "Référence", "Fournisseur", "Objet", "Montant TTC", "Mode de règlement", "Payée le"], register.rows.map((r) => [r.date, r.reference, r.supplier, r.label, csvAmount(dec(r.amount)), r.method, r.paidAt ?? ""]));
}

