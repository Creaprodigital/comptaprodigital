import Decimal from "decimal.js";
import type { Prisma, Purchase, Supplier } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { resolveCategory } from "@/server/modules/bank/categories";
import { normalizeLabel } from "@/server/modules/bank/labels";
import { refreshTransactionState } from "@/server/modules/bank/status";
import { documentHistory, type HistoryEntry, type Meta } from "@/server/modules/invoicing/shared";
import { syncAccountingFor } from "@/server/modules/accounting/sync";
import { dec, sum, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis, formatIsoForHumans } from "@/lib/dates";
import type { PurchaseInput, SupplierInput } from "@/lib/schemas/accounting";

/**
 * Achats : fournisseurs et factures d'achat. Une facture d'achat alimente le
 * journal des achats et la TVA déductible ; elle est réglée par une ou plusieurs
 * opérations bancaires de décaissement qui lui sont rapprochées.
 */

const euros = (value: Decimal.Value) => `${new Decimal(value).toFixed(2).replace(".", ",")} €`;

// --- Fournisseurs ---------------------------------------------------------------------

export type SupplierView = ReturnType<typeof serializeSupplier> & { outstanding: string; purchaseCount: number };

export function serializeSupplier(supplier: Supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    siren: supplier.siren,
    vatNumber: supplier.vatNumber,
    addressLine1: supplier.addressLine1,
    postalCode: supplier.postalCode,
    city: supplier.city,
    country: supplier.country,
    notes: supplier.notes,
    accountNumber: supplier.accountNumber,
    archived: supplier.archivedAt !== null,
  };
}

export async function listSuppliers(access: CompanyAccess, options: { q?: string; archived?: boolean } = {}): Promise<SupplierView[]> {
  const suppliers = await access.db.supplier.findMany({
    where: { archivedAt: options.archived ? { not: null } : null, ...(options.q ? { OR: [{ name: { contains: options.q } }, { siren: { contains: options.q } }, { city: { contains: options.q } }] } : {}) },
    orderBy: { name: "asc" },
    take: 500,
  });
  const totals = suppliers.length
    ? await access.db.purchase.groupBy({ by: ["supplierId"], where: { supplierId: { in: suppliers.map((s) => s.id) }, status: { in: ["TO_PAY", "PAID"] } }, _sum: { totalInclTax: true, amountPaid: true }, _count: { _all: true } })
    : [];
  const bySupplier = new Map(totals.map((row) => [row.supplierId, row]));
  return suppliers.map((supplier) => {
    const row = bySupplier.get(supplier.id);
    return { ...serializeSupplier(supplier), outstanding: toMoneyString(dec(row?._sum.totalInclTax).minus(dec(row?._sum.amountPaid))), purchaseCount: row?._count._all ?? 0 };
  });
}

function supplierData(input: SupplierInput) {
  return {
    name: input.name,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    siren: input.siren ?? null,
    vatNumber: input.vatNumber ?? null,
    addressLine1: input.addressLine1 ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    country: input.country ?? "FR",
    notes: input.notes ?? null,
  };
}

export async function createSupplier(access: CompanyAccess, userId: string, input: SupplierInput, meta: Meta = {}) {
  const supplier = await access.db.supplier.create({ data: { companyId: access.company.id, ...supplierData(input) } });
  await recordAudit({ action: "supplier.create", userId, companyId: access.company.id, entityType: "Supplier", entityId: supplier.id, ...meta });
  return serializeSupplier(supplier);
}

export async function updateSupplier(access: CompanyAccess, userId: string, supplierId: string, input: SupplierInput, meta: Meta = {}) {
  if (!(await access.db.supplier.findFirst({ where: { id: supplierId }, select: { id: true } }))) throw errors.notFound("Fournisseur introuvable.");
  const supplier = await access.db.supplier.update({ where: { id: supplierId }, data: supplierData(input) });
  await recordAudit({ action: "supplier.update", userId, companyId: access.company.id, entityType: "Supplier", entityId: supplierId, ...meta });
  return serializeSupplier(supplier);
}

export async function setSupplierArchived(access: CompanyAccess, userId: string, supplierId: string, archived: boolean, meta: Meta = {}) {
  if (!(await access.db.supplier.findFirst({ where: { id: supplierId }, select: { id: true } }))) throw errors.notFound("Fournisseur introuvable.");
  const supplier = await access.db.supplier.update({ where: { id: supplierId }, data: { archivedAt: archived ? new Date() : null } });
  await recordAudit({ action: archived ? "supplier.archive" : "supplier.restore", userId, companyId: access.company.id, entityType: "Supplier", entityId: supplierId, ...meta });
  return serializeSupplier(supplier);
}

// --- Factures d'achat -------------------------------------------------------------------

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, accountNumber: true, kind: true } },
  bankTransactions: { select: { id: true, date: true, label: true, amount: true }, orderBy: { date: "asc" } },
} satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

export type PurchaseView = {
  id: string;
  reference: string | null;
  label: string;
  supplier: { id: string; name: string } | null;
  category: { id: string; name: string; accountNumber: string | null } | null;
  issueDate: string;
  dueDate: string | null;
  status: Purchase["status"];
  overdue: boolean;
  operationCategory: Purchase["operationCategory"];
  supplierVatOnDebits: boolean;
  totalExclTax: string;
  totalVat: string;
  totalInclTax: string;
  amountPaid: string;
  remaining: string;
  paidAt: string | null;
  notes: string | null;
  payments: Array<{ transactionId: string; date: string; label: string; amount: string }>;
};

export function serializePurchase(row: PurchaseRow, today = todayInParis()): PurchaseView {
  const remaining = dec(row.totalInclTax).minus(dec(row.amountPaid));
  const dueDate = row.dueDate ? toIsoDate(row.dueDate) : null;
  return {
    id: row.id,
    reference: row.reference,
    label: row.label,
    supplier: row.supplier,
    category: row.category ? { id: row.category.id, name: row.category.name, accountNumber: row.category.accountNumber } : null,
    issueDate: toIsoDate(row.issueDate),
    dueDate,
    status: row.status,
    overdue: row.status === "TO_PAY" && dueDate !== null && dueDate < today,
    operationCategory: row.operationCategory,
    supplierVatOnDebits: row.supplierVatOnDebits,
    totalExclTax: toMoneyString(row.totalExclTax),
    totalVat: toMoneyString(row.totalVat),
    totalInclTax: toMoneyString(row.totalInclTax),
    amountPaid: toMoneyString(row.amountPaid),
    remaining: toMoneyString(remaining),
    paidAt: row.paidAt ? toIsoDate(row.paidAt) : null,
    notes: row.notes,
    payments: row.bankTransactions.map((t) => ({ transactionId: t.id, date: toIsoDate(t.date), label: t.label, amount: toMoneyString(dec(t.amount).negated()) })),
  };
}

export type PurchasesQuery = { q?: string; status?: "TO_PAY" | "PAID" | "CANCELLED" | "overdue"; supplierId?: string; page?: number; pageSize?: number };

export async function listPurchases(access: CompanyAccess, query: PurchasesQuery = {}) {
  const { page = 1, pageSize = 30 } = query;
  const today = todayInParis();
  const where: Prisma.PurchaseWhereInput = {};
  if (query.status === "overdue") Object.assign(where, { status: "TO_PAY", dueDate: { lt: fromIsoDate(today) } });
  else if (query.status) where.status = query.status;
  else where.status = { not: "CANCELLED" };
  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.q) where.OR = [{ label: { contains: query.q } }, { reference: { contains: query.q } }, { supplier: { name: { contains: query.q } } }];
  const [rows, total, open] = await Promise.all([
    access.db.purchase.findMany({ where, include: purchaseInclude, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    access.db.purchase.count({ where }),
    access.db.purchase.aggregate({ where: { status: "TO_PAY" }, _sum: { totalInclTax: true, amountPaid: true }, _count: { _all: true } }),
  ]);
  return {
    items: rows.map((row) => serializePurchase(row, today)),
    total,
    page,
    pageSize,
    summary: { toPayCount: open._count._all, toPayAmount: toMoneyString(dec(open._sum.totalInclTax).minus(dec(open._sum.amountPaid))) },
  };
}

async function findPurchase(access: CompanyAccess, purchaseId: string): Promise<PurchaseRow> {
  const row = await access.db.purchase.findFirst({ where: { id: purchaseId }, include: purchaseInclude });
  if (!row) throw errors.notFound("Facture d'achat introuvable.");
  return row;
}

export async function getPurchase(access: CompanyAccess, purchaseId: string): Promise<PurchaseView> {
  return serializePurchase(await findPurchase(access, purchaseId));
}

export async function getPurchaseHistory(access: CompanyAccess, purchaseId: string): Promise<HistoryEntry[]> {
  await findPurchase(access, purchaseId);
  return documentHistory(access.company.id, "Purchase", purchaseId);
}

async function purchaseData(access: CompanyAccess, input: PurchaseInput, exceptId?: string) {
  const companyId = access.company.id;
  if (input.supplierId && !(await access.db.supplier.findFirst({ where: { id: input.supplierId }, select: { id: true } }))) {
    throw errors.validation([{ path: "supplierId", message: "Fournisseur introuvable" }]);
  }
  await resolveCategory(companyId, input.categoryId);
  if (input.issueDate > todayInParis()) throw errors.validation([{ path: "issueDate", message: "La date de la facture ne peut pas être dans le futur" }]);
  if (input.reference && input.supplierId) {
    const duplicate = await access.db.purchase.findFirst({ where: { supplierId: input.supplierId, reference: input.reference, status: { not: "CANCELLED" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (duplicate) throw errors.validation([{ path: "reference", message: "Une facture de ce fournisseur porte déjà ce numéro" }]);
  }
  const totalVat = input.totalVat ?? "0";
  return {
    supplierId: input.supplierId ?? null,
    reference: input.reference ?? null,
    label: input.label,
    issueDate: fromIsoDate(input.issueDate),
    dueDate: input.dueDate ? fromIsoDate(input.dueDate) : null,
    categoryId: input.categoryId,
    operationCategory: input.operationCategory ?? "SERVICES",
    supplierVatOnDebits: input.supplierVatOnDebits ?? false,
    totalExclTax: new Decimal(input.totalExclTax).toFixed(2),
    totalVat: new Decimal(totalVat).toFixed(2),
    totalInclTax: new Decimal(input.totalExclTax).plus(totalVat).toFixed(2),
    notes: input.notes ?? null,
  };
}

export async function createPurchase(access: CompanyAccess, userId: string, input: PurchaseInput, meta: Meta = {}): Promise<PurchaseView> {
  const companyId = access.company.id;
  const data = await purchaseData(access, input);
  const purchase = await access.db.purchase.create({ data: { companyId, ...data, status: "TO_PAY", createdById: userId } });
  await recordAudit({ action: "purchase.create", userId, companyId, entityType: "Purchase", entityId: purchase.id, metadata: { detail: `Facture d'achat enregistrée (${euros(data.totalInclTax)} TTC)` }, ...meta });
  await syncAccountingFor(access.company, [{ type: "PURCHASE", id: purchase.id }]);
  return getPurchase(access, purchase.id);
}

/** Modification : possible tant qu'aucun règlement n'est rapproché. L'écriture validée éventuelle est contre-passée. */
export async function updatePurchase(access: CompanyAccess, userId: string, purchaseId: string, input: PurchaseInput, meta: Meta = {}): Promise<PurchaseView> {
  const current = await findPurchase(access, purchaseId);
  if (current.status === "CANCELLED") throw errors.conflict("PURCHASE_CANCELLED", "Cette facture d'achat est annulée.");
  if (current.bankTransactions.length > 0) throw errors.conflict("PURCHASE_PAID", "Des règlements sont rapprochés de cette facture : retirez-les avant de la modifier.");
  const data = await purchaseData(access, input, purchaseId);
  await access.db.purchase.update({ where: { id: purchaseId }, data });
  await recordAudit({ action: "purchase.update", userId, companyId: access.company.id, entityType: "Purchase", entityId: purchaseId, metadata: { detail: "Facture d'achat modifiée" }, ...meta });
  await syncAccountingFor(access.company, [{ type: "PURCHASE", id: purchaseId }]);
  return getPurchase(access, purchaseId);
}

export async function cancelPurchase(access: CompanyAccess, userId: string, purchaseId: string, meta: Meta = {}): Promise<PurchaseView> {
  const current = await findPurchase(access, purchaseId);
  if (current.bankTransactions.length > 0) throw errors.conflict("PURCHASE_PAID", "Des règlements sont rapprochés de cette facture : retirez-les avant de l'annuler.");
  if (current.status !== "CANCELLED") {
    await access.db.purchase.update({ where: { id: purchaseId }, data: { status: "CANCELLED" } });
    await recordAudit({ action: "purchase.cancel", userId, companyId: access.company.id, entityType: "Purchase", entityId: purchaseId, metadata: { detail: "Facture d'achat annulée" }, ...meta });
    await syncAccountingFor(access.company, [{ type: "PURCHASE", id: purchaseId }]);
  }
  return getPurchase(access, purchaseId);
}

export async function purchasesCsv(access: CompanyAccess): Promise<string> {
  const rows = await access.db.purchase.findMany({ include: purchaseInclude, orderBy: { issueDate: "asc" }, take: 20_000 });
  return toCsv(
    ["Date", "Fournisseur", "Numéro", "Objet", "Catégorie", "HT", "TVA", "TTC", "Réglé", "Statut", "Échéance"],
    rows.map((r) => [toIsoDate(r.issueDate), r.supplier?.name ?? "", r.reference ?? "", r.label, r.category?.name ?? "", csvAmount(r.totalExclTax), csvAmount(r.totalVat), csvAmount(r.totalInclTax), csvAmount(r.amountPaid), { TO_PAY: "À payer", PAID: "Payée", CANCELLED: "Annulée", DRAFT: "Brouillon" }[r.status], r.dueDate ? toIsoDate(r.dueDate) : ""]),
  );
}

// --- Règlement par la banque -------------------------------------------------------------

async function recomputePurchase(tx: Prisma.TransactionClient, companyId: string, purchaseId: string) {
  const purchase = await tx.purchase.findFirstOrThrow({ where: { id: purchaseId, companyId }, include: { bankTransactions: { select: { amount: true, date: true } } } });
  const paid = sum(purchase.bankTransactions.map((t) => dec(t.amount).negated()));
  const lastDate = purchase.bankTransactions.map((t) => t.date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const settled = paid.greaterThanOrEqualTo(dec(purchase.totalInclTax));
  await tx.purchase.update({ where: { id: purchaseId }, data: { amountPaid: paid.toFixed(2), status: purchase.status === "CANCELLED" ? "CANCELLED" : settled ? "PAID" : "TO_PAY", paidAt: settled ? lastDate : null } });
}

/** Factures d'achat à régler pouvant correspondre à un décaissement. */
export async function suggestPurchases(access: CompanyAccess, transaction: { amount: string; label: string; date: string }) {
  const amount = new Decimal(transaction.amount).negated();
  if (amount.lessThanOrEqualTo(0)) return [];
  const label = ` ${normalizeLabel(transaction.label)} `;
  const rows = await access.db.purchase.findMany({ where: { status: "TO_PAY" }, include: purchaseInclude, orderBy: { issueDate: "desc" }, take: 300 });
  return rows
    .map((row) => {
      const view = serializePurchase(row);
      const reasons: string[] = [];
      let score = 0;
      if (new Decimal(view.remaining).equals(amount)) {
        score += 40;
        reasons.push("Montant identique");
      }
      const supplier = row.supplier ? normalizeLabel(row.supplier.name) : "";
      if (supplier.length >= 4 && label.includes(supplier)) {
        score += 30;
        reasons.push("Nom du fournisseur dans le libellé");
      }
      if (row.reference && normalizeLabel(row.reference).length >= 3 && label.includes(` ${normalizeLabel(row.reference)} `)) {
        score += 30;
        reasons.push("Numéro de facture dans le libellé");
      }
      return { purchase: view, score, reasons, fits: new Decimal(view.remaining).greaterThanOrEqualTo(amount) };
    })
    .filter((s) => s.fits)
    .sort((a, b) => b.score - a.score || b.purchase.issueDate.localeCompare(a.purchase.issueDate))
    .slice(0, 20);
}

/** Rapproche un décaissement d'une facture d'achat : la facture est réglée d'autant. */
export async function linkPurchasePayment(access: CompanyAccess, userId: string, transactionId: string, purchaseId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  await prisma.$transaction(async (tx) => {
    const lockedTx = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bank_transactions WHERE id = ${transactionId} AND companyId = ${companyId} FOR UPDATE`;
    if (lockedTx.length === 0) throw errors.notFound("Opération bancaire introuvable.");
    const lockedPurchase = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM purchases WHERE id = ${purchaseId} AND companyId = ${companyId} FOR UPDATE`;
    if (lockedPurchase.length === 0) throw errors.notFound("Facture d'achat introuvable.");
    const transaction = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (dec(transaction.amount).greaterThanOrEqualTo(0)) throw errors.badRequest("NOT_AN_OUTFLOW", "Seul un décaissement peut régler une facture d'achat.");
    if (transaction.purchaseId) throw errors.conflict("ALREADY_LINKED", "Cette opération est déjà rapprochée d'une facture d'achat.");
    if (purchase.status !== "TO_PAY") throw errors.badRequest("NOT_PAYABLE", "Cette facture d'achat n'est pas en attente de règlement.");
    const remaining = dec(purchase.totalInclTax).minus(dec(purchase.amountPaid));
    const amount = dec(transaction.amount).negated();
    if (amount.greaterThan(remaining)) throw errors.validation([{ path: "purchaseId", message: `Le décaissement (${euros(amount)}) dépasse le reste à payer de la facture (${euros(remaining)})` }]);
    if (toIsoDate(transaction.date) < toIsoDate(purchase.issueDate)) throw errors.validation([{ path: "purchaseId", message: `Le décaissement du ${formatIsoForHumans(toIsoDate(transaction.date))} précède la facture d'achat` }]);
    await tx.bankTransaction.update({ where: { id: transactionId }, data: { purchaseId, categoryId: purchase.categoryId ?? transaction.categoryId, vatRate: null, vatAmount: null } });
    await recomputePurchase(tx, companyId, purchaseId);
    await refreshTransactionState(tx, companyId, transactionId);
    const label = `facture d'achat ${purchase.reference ?? purchase.label}`;
    await recordAudit({ action: "bank.transaction.purchase_linked", userId, companyId, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: `Rapprochée de la ${label}` }, ...meta }, tx);
    await recordAudit({ action: "purchase.payment", userId, companyId, entityType: "Purchase", entityId: purchaseId, metadata: { detail: `Règlement de ${euros(amount)} rapproché de l'opération bancaire du ${formatIsoForHumans(toIsoDate(transaction.date))}` }, ...meta }, tx);
  });
  await syncAccountingFor(access.company, [{ type: "BANK_TRANSACTION", id: transactionId }, { type: "PURCHASE", id: purchaseId }]);
}

export async function unlinkPurchasePayment(access: CompanyAccess, userId: string, transactionId: string, meta: Meta = {}): Promise<void> {
  const companyId = access.company.id;
  let purchaseId: string | null = null;
  await prisma.$transaction(async (tx) => {
    const lockedTx = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bank_transactions WHERE id = ${transactionId} AND companyId = ${companyId} FOR UPDATE`;
    if (lockedTx.length === 0) throw errors.notFound("Opération bancaire introuvable.");
    const transaction = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    if (!transaction.purchaseId) throw errors.badRequest("NOT_LINKED", "Cette opération n'est rapprochée d'aucune facture d'achat.");
    purchaseId = transaction.purchaseId;
    await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${purchaseId} AND companyId = ${companyId} FOR UPDATE`;
    await tx.bankTransaction.update({ where: { id: transactionId }, data: { purchaseId: null } });
    await recomputePurchase(tx, companyId, purchaseId);
    await refreshTransactionState(tx, companyId, transactionId);
    await recordAudit({ action: "bank.transaction.purchase_unlinked", userId, companyId, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: "Rapprochement avec la facture d'achat annulé" }, ...meta }, tx);
    await recordAudit({ action: "purchase.payment_removed", userId, companyId, entityType: "Purchase", entityId: purchaseId, metadata: { detail: `Règlement de ${euros(dec(transaction.amount).negated())} retiré (rapprochement annulé)` }, ...meta }, tx);
  });
  await syncAccountingFor(access.company, [{ type: "BANK_TRANSACTION", id: transactionId }, ...(purchaseId ? [{ type: "PURCHASE" as const, id: purchaseId }] : [])]);
}

