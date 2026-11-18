import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { settledStatus } from "@/server/modules/invoicing/invoices";
import { withTransactionRetry, type Meta } from "@/server/modules/invoicing/shared";
import { remainingAmount } from "@/lib/invoicing";
import { dec, sum, toMoneyString, ZERO } from "@/lib/money";
import { addDays, formatIsoForHumans, fromIsoDate, toIsoDate } from "@/lib/dates";
import type { ReconcileInput } from "@/lib/schemas/bank";
import { normalizeLabel } from "./labels";
import { refreshTransactionState } from "./status";
import { getTransaction, type TransactionView } from "./transactions";
import { syncAccountingFor, type SourceRefInput } from "@/server/modules/accounting/sync";

/**
 * Rapprochement bancaire : un encaissement est affecté à une ou plusieurs
 * factures. Chaque affectation crée un règlement sur la facture (ou reprend un
 * règlement déjà saisi à la main, pour ne pas le compter deux fois). L'annulation
 * retire les règlements créés par le rapprochement et remet les factures dans
 * leur état antérieur ; rien n'est modifié silencieusement, tout est journalisé.
 */

const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;
const euros = (value: Decimal.Value) => `${new Decimal(value).toFixed(2).replace(".", ",")} €`;

export type InvoiceSuggestion = {
  invoiceId: string;
  number: string | null;
  customerName: string;
  issueDate: string | null;
  dueDate: string | null;
  totalInclTax: string;
  remaining: string;
  /** Montant proposé : le plus petit du reste dû et du montant encore disponible sur l'opération. */
  proposed: string;
  score: number;
  reasons: string[];
};

export type PaymentSuggestion = { paymentId: string; invoiceId: string; invoiceNumber: string | null; customerName: string; amount: string; paidAt: string; exact: boolean };

export type ReconciliationSuggestions = { available: string; invoices: InvoiceSuggestion[]; payments: PaymentSuggestion[] };

/** Factures ouvertes et règlements non rapprochés susceptibles de correspondre à un encaissement. */
export async function suggestReconciliation(access: CompanyAccess, transaction: TransactionView): Promise<ReconciliationSuggestions> {
  const amount = new Decimal(transaction.amount);
  const available = amount.minus(transaction.allocated);
  if (amount.lessThanOrEqualTo(0) || available.lessThanOrEqualTo(0)) return { available: toMoneyString(Decimal.max(available, ZERO)), invoices: [], payments: [] };

  const label = ` ${normalizeLabel(transaction.label)} `;
  const [invoices, payments] = await Promise.all([
    access.db.invoice.findMany({
      where: { type: { in: ["INVOICE", "DEPOSIT"] }, status: { in: [...OPEN_STATUSES] } },
      select: { id: true, number: true, issueDate: true, dueDate: true, totalInclTax: true, amountPaid: true, creditedAmount: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take: 500,
    }),
    access.db.payment.findMany({
      where: { bankTransactionId: null, amount: { lte: available.toFixed(2) }, paidAt: { gte: fromIsoDate(addDays(transaction.date, -15)), lte: fromIsoDate(addDays(transaction.date, 15)) } },
      include: { invoice: { select: { number: true, customer: { select: { name: true } } } } },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
  ]);

  const suggestions = invoices
    .map((invoice): InvoiceSuggestion => {
      const remaining = remainingAmount(invoice);
      const reasons: string[] = [];
      let score = 0;
      if (invoice.number && label.includes(` ${normalizeLabel(invoice.number)} `)) {
        score += 60;
        reasons.push("Numéro de facture dans le libellé");
      }
      if (remaining.equals(available)) {
        score += 30;
        reasons.push("Montant identique");
      }
      const customer = normalizeLabel(invoice.customer.name);
      if (customer.length >= 4 && label.includes(customer)) {
        score += 20;
        reasons.push("Nom du client dans le libellé");
      }
      return {
        invoiceId: invoice.id,
        number: invoice.number,
        customerName: invoice.customer.name,
        issueDate: invoice.issueDate ? toIsoDate(invoice.issueDate) : null,
        dueDate: invoice.dueDate ? toIsoDate(invoice.dueDate) : null,
        totalInclTax: toMoneyString(invoice.totalInclTax),
        remaining: toMoneyString(remaining),
        proposed: toMoneyString(Decimal.min(remaining, available)),
        score,
        reasons,
      };
    })
    .filter((s) => new Decimal(s.remaining).greaterThan(0))
    .sort((a, b) => b.score - a.score || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 25);

  return {
    available: toMoneyString(available),
    invoices: suggestions,
    payments: payments
      .map((p) => ({ paymentId: p.id, invoiceId: p.invoiceId, invoiceNumber: p.invoice.number, customerName: p.invoice.customer.name, amount: toMoneyString(p.amount), paidAt: toIsoDate(p.paidAt), exact: dec(p.amount).equals(available) }))
      .sort((a, b) => Number(b.exact) - Number(a.exact)),
  };
}

export async function reconcileTransaction(access: CompanyAccess, userId: string, transactionId: string, input: ReconcileInput, meta: Meta = {}): Promise<TransactionView> {
  const companyId = access.company.id;
  const invoiceIds = input.allocations.flatMap((a) => ("invoiceId" in a ? [a.invoiceId] : []));
  if (new Set(invoiceIds).size !== invoiceIds.length) throw errors.validation([{ path: "allocations", message: "Une même facture est sélectionnée deux fois" }]);

  const touched: SourceRefInput[] = [{ type: "BANK_TRANSACTION", id: transactionId }];
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bank_transactions WHERE id = ${transactionId} AND companyId = ${companyId} FOR UPDATE`;
        if (locked.length === 0) throw errors.notFound("Opération bancaire introuvable.");
        const transaction = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { payments: { select: { amount: true } } } });
        if (dec(transaction.amount).lessThanOrEqualTo(0)) throw errors.badRequest("NOT_AN_INFLOW", "Seul un encaissement peut être rapproché d'une facture de vente.");
        const date = toIsoDate(transaction.date);
        let available = dec(transaction.amount).minus(sum(transaction.payments.map((p) => p.amount)));
        const done: string[] = [];

        const take = (amount: Decimal) => {
          if (amount.greaterThan(available)) throw errors.validation([{ path: "allocations", message: `Le total affecté dépasse le montant disponible de l'opération (${euros(available)} restants)` }]);
          available = available.minus(amount);
        };

        // Les factures sont verrouillées dans un ordre constant pour éviter les interblocages.
        for (const allocation of [...input.allocations].sort((a, b) => ("invoiceId" in a ? a.invoiceId : a.paymentId).localeCompare("invoiceId" in b ? b.invoiceId : b.paymentId))) {
          if ("paymentId" in allocation) {
            // Règlement déjà saisi sur la facture : il est rattaché à l'opération, sans nouveau règlement.
            const payment = await tx.payment.findFirst({ where: { id: allocation.paymentId, companyId, bankTransactionId: null }, include: { invoice: { select: { number: true } } } });
            if (!payment) throw errors.validation([{ path: "allocations", message: "Ce règlement est introuvable ou déjà rapproché" }]);
            take(dec(payment.amount));
            await tx.payment.update({ where: { id: payment.id }, data: { bankTransactionId: transactionId } });
            touched.push({ type: "PAYMENT", id: payment.id });
            done.push(`règlement de ${euros(payment.amount)} déjà enregistré sur la facture ${payment.invoice.number ?? ""}`);
            continue;
          }
          const lockedInvoice = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM invoices WHERE id = ${allocation.invoiceId} AND companyId = ${companyId} FOR UPDATE`;
          if (lockedInvoice.length === 0) throw errors.notFound("Facture introuvable.");
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
          if (invoice.type === "CREDIT_NOTE" || invoice.status === "DRAFT" || invoice.status === "CANCELLED") throw errors.badRequest("NOT_PAYABLE", "Seule une facture émise peut être rapprochée.");
          if (invoice.issueDate && date < toIsoDate(invoice.issueDate) && invoice.type !== "DEPOSIT") {
            throw errors.validation([{ path: "allocations", message: `L'opération du ${formatIsoForHumans(date)} précède la date de la facture ${invoice.number ?? ""}` }]);
          }
          const amount = new Decimal(allocation.amount);
          const remaining = remainingAmount(invoice);
          if (amount.greaterThan(remaining)) throw errors.validation([{ path: "allocations", message: `Le montant dépasse le reste à encaisser de la facture ${invoice.number ?? ""} (${euros(remaining)})` }]);
          take(amount);
          const created = await tx.payment.create({
            data: { companyId, invoiceId: invoice.id, amount: amount.toFixed(2), paidAt: transaction.date, method: "TRANSFER", reference: transaction.label.slice(0, 191), bankTransactionId: transactionId, createdFromBank: true, createdById: userId },
          });
          touched.push({ type: "PAYMENT", id: created.id });
          const amountPaid = dec(invoice.amountPaid).plus(amount);
          const status = settledStatus({ ...invoice, amountPaid });
          await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: amountPaid.toFixed(2), status, paidAt: status === "PAID" ? transaction.date : null } });
          await recordAudit(
            { action: "invoice.payment", userId, companyId, entityType: "Invoice", entityId: invoice.id, metadata: { detail: `Règlement de ${euros(amount)} rapproché de l'opération bancaire du ${formatIsoForHumans(date)}`, amount: amount.toFixed(2), bankTransactionId: transactionId }, ...meta },
            tx,
          );
          done.push(`${euros(amount)} sur la facture ${invoice.number ?? ""}`);
        }

        // Un encaissement rapproché sans catégorie est classé en ventes.
        if (!transaction.categoryId) {
          const sales = await tx.transactionCategory.findFirst({ where: { companyId: null, kind: "INCOME", isActive: true }, orderBy: { accountNumber: "asc" } });
          if (sales) await tx.bankTransaction.update({ where: { id: transactionId }, data: { categoryId: sales.id } });
        }
        await refreshTransactionState(tx, companyId, transactionId);
        await recordAudit({ action: "bank.transaction.reconciled", userId, companyId, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: `Rapprochement : ${done.join(" ; ")}` }, ...meta }, tx);
      },
      { timeout: 20_000 },
    ),
  );
  await syncAccountingFor(access.company, touched);
  return getTransaction(access, transactionId);
}

/** Annule le rapprochement d'une opération avec ses factures. */
export async function unreconcileTransaction(access: CompanyAccess, userId: string, transactionId: string, meta: Meta = {}): Promise<TransactionView> {
  const companyId = access.company.id;
  const touched: SourceRefInput[] = [{ type: "BANK_TRANSACTION", id: transactionId }];
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bank_transactions WHERE id = ${transactionId} AND companyId = ${companyId} FOR UPDATE`;
        if (locked.length === 0) throw errors.notFound("Opération bancaire introuvable.");
        const payments = await tx.payment.findMany({ where: { companyId, bankTransactionId: transactionId }, orderBy: { invoiceId: "asc" } });
        if (payments.length === 0) throw errors.badRequest("NOT_RECONCILED", "Cette opération n'est rapprochée d'aucune facture.");
        for (const payment of payments) {
          touched.push({ type: "PAYMENT", id: payment.id });
          if (!payment.createdFromBank) {
            // Règlement saisi à la main avant le rapprochement : il reste sur la facture.
            await tx.payment.update({ where: { id: payment.id }, data: { bankTransactionId: null } });
            continue;
          }
          await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${payment.invoiceId} AND companyId = ${companyId} FOR UPDATE`;
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
          await tx.payment.delete({ where: { id: payment.id } });
          const amountPaid = Decimal.max(dec(invoice.amountPaid).minus(dec(payment.amount)), ZERO);
          const status = settledStatus({ ...invoice, amountPaid });
          await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: amountPaid.toFixed(2), status, paidAt: status === "PAID" ? invoice.paidAt : null } });
          await recordAudit(
            { action: "invoice.payment_deleted", userId, companyId, entityType: "Invoice", entityId: invoice.id, metadata: { detail: `Règlement de ${euros(payment.amount)} retiré : rapprochement bancaire annulé`, bankTransactionId: transactionId }, ...meta },
            tx,
          );
        }
        await refreshTransactionState(tx, companyId, transactionId);
        await recordAudit({ action: "bank.transaction.unreconciled", userId, companyId, entityType: "BankTransaction", entityId: transactionId, metadata: { detail: `Rapprochement annulé (${payments.length} règlement${payments.length > 1 ? "s" : ""})` }, ...meta }, tx);
      },
      { timeout: 20_000 },
    ),
  );
  await syncAccountingFor(access.company, touched);
  return getTransaction(access, transactionId);
}
