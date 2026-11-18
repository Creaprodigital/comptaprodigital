import type { BankTransactionStatus, Prisma } from "@prisma/client";
import { dec, sum, type DecimalInput } from "@/lib/money";

/**
 * Statut d'une opération bancaire :
 *  - « rapprochée » : encaissement entièrement affecté à des factures, décaissement
 *    rapproché d'une facture d'achat, ou opération
 *    catégorisée et appuyée par un justificatif ;
 *  - « catégorisée » : une catégorie, mais ni facture ni justificatif ;
 *  - « à traiter » : rien n'a encore été fait.
 */
export function computeTransactionStatus(input: { amount: DecimalInput; categoryId: string | null; allocated: DecimalInput; documentCount: number; purchaseId?: string | null }): BankTransactionStatus {
  const amount = dec(input.amount);
  if (amount.greaterThan(0) && dec(input.allocated).greaterThanOrEqualTo(amount)) return "RECONCILED";
  // Décaissement rapproché d'une facture d'achat : la facture est le justificatif.
  if (input.purchaseId) return "RECONCILED";
  if (input.categoryId && input.documentCount > 0) return "RECONCILED";
  return input.categoryId ? "CATEGORIZED" : "TO_REVIEW";
}

/** Recompte les justificatifs et les règlements d'une opération, puis met son statut à jour. */
export async function refreshTransactionState(tx: Prisma.TransactionClient, companyId: string, transactionId: string): Promise<void> {
  const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, companyId }, include: { payments: { select: { amount: true } } } });
  if (!transaction) return;
  const documentCount = await tx.documentLink.count({ where: { companyId, entityType: "BANK_TRANSACTION", entityId: transactionId, document: { deletedAt: null } } });
  const status = computeTransactionStatus({ amount: transaction.amount, categoryId: transaction.categoryId, allocated: sum(transaction.payments.map((p) => p.amount)), documentCount, purchaseId: transaction.purchaseId });
  await tx.bankTransaction.update({
    where: { id: transactionId },
    data: { documentCount, status, reconciledAt: status === "RECONCILED" ? (transaction.reconciledAt ?? new Date()) : null },
  });
}

/** Décaissements sans justificatif ni facture d'achat : non catégorisés, ou classés en charges ou en frais de personnel. */
export const UNJUSTIFIED_WHERE = {
  amount: { lt: 0 },
  documentCount: 0,
  purchaseId: null,
  OR: [{ categoryId: null }, { category: { kind: { in: ["EXPENSE", "PAYROLL"] } } }],
} satisfies Prisma.BankTransactionWhereInput;
