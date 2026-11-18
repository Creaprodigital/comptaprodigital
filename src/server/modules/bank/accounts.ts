import type { BankAccount } from "@prisma/client";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { encryptSecret } from "@/server/security/crypto";
import { syncAccountingFor } from "@/server/modules/accounting/sync";
import type { Meta } from "@/server/modules/invoicing/shared";
import { dec, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate } from "@/lib/dates";
import type { BankAccountInput } from "@/lib/schemas/bank";

/**
 * Comptes bancaires de l'entreprise. L'IBAN est chiffré en base ; seuls ses
 * quatre derniers caractères sont affichés. Aucun identifiant de connexion
 * bancaire n'est demandé ni conservé.
 */

export type BankAccountView = {
  id: string;
  name: string;
  bankName: string | null;
  ibanMasked: string | null;
  bic: string | null;
  currency: string;
  openingBalance: string;
  openingBalanceDate: string | null;
  balance: string;
  transactionCount: number;
  toReviewCount: number;
  lastTransactionDate: string | null;
  isActive: boolean;
  provider: BankAccount["provider"];
};

async function toView(access: CompanyAccess, account: BankAccount): Promise<BankAccountView> {
  // Le solde part du solde d'ouverture : seules les opérations postérieures à sa date sont ajoutées.
  const since = account.openingBalanceDate ? { date: { gte: account.openingBalanceDate } } : {};
  const [movement, all, toReview] = await Promise.all([
    access.db.bankTransaction.aggregate({ where: { bankAccountId: account.id, ...since }, _sum: { amount: true } }),
    access.db.bankTransaction.aggregate({ where: { bankAccountId: account.id }, _count: { _all: true }, _max: { date: true } }),
    access.db.bankTransaction.count({ where: { bankAccountId: account.id, status: "TO_REVIEW" } }),
  ]);
  return {
    id: account.id,
    name: account.name,
    bankName: account.bankName,
    ibanMasked: account.ibanLast4 ? `•••• ${account.ibanLast4}` : null,
    bic: account.bic,
    currency: account.currency,
    openingBalance: toMoneyString(account.openingBalance),
    openingBalanceDate: account.openingBalanceDate ? toIsoDate(account.openingBalanceDate) : null,
    balance: toMoneyString(dec(account.openingBalance).plus(dec(movement._sum.amount))),
    transactionCount: all._count._all,
    toReviewCount: toReview,
    lastTransactionDate: all._max.date ? toIsoDate(all._max.date) : null,
    isActive: account.isActive,
    provider: account.provider,
  };
}

export async function listBankAccounts(access: CompanyAccess, options: { includeInactive?: boolean } = {}): Promise<BankAccountView[]> {
  const accounts = await access.db.bankAccount.findMany({ where: options.includeInactive ? {} : { isActive: true }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  return Promise.all(accounts.map((account) => toView(access, account)));
}

export async function getBankAccount(access: CompanyAccess, accountId: string): Promise<BankAccount> {
  const account = await access.db.bankAccount.findFirst({ where: { id: accountId } });
  if (!account) throw errors.notFound("Compte bancaire introuvable.");
  return account;
}

function toData(input: BankAccountInput) {
  return {
    name: input.name,
    bankName: input.bankName ?? null,
    bic: input.bic ?? null,
    openingBalance: input.openingBalance ?? "0",
    openingBalanceDate: input.openingBalanceDate ? fromIsoDate(input.openingBalanceDate) : null,
  };
}

export async function createBankAccount(access: CompanyAccess, userId: string, input: BankAccountInput, meta: Meta = {}): Promise<BankAccountView> {
  const account = await access.db.bankAccount.create({
    data: {
      companyId: access.company.id,
      ...toData(input),
      currency: access.company.currency,
      ibanEncrypted: input.iban ? encryptSecret(input.iban) : null,
      ibanLast4: input.iban ? input.iban.slice(-4) : null,
    },
  });
  await recordAudit({ action: "bank.account.create", userId, companyId: access.company.id, entityType: "BankAccount", entityId: account.id, metadata: { name: account.name }, ...meta });
  await syncAccountingFor(access.company, [{ type: "OPENING", id: account.id }]);
  return toView(access, account);
}

/** L'IBAN n'est modifié que s'il est fourni : un champ laissé vide conserve la valeur enregistrée. */
export async function updateBankAccount(access: CompanyAccess, userId: string, accountId: string, input: BankAccountInput, meta: Meta = {}): Promise<BankAccountView> {
  await getBankAccount(access, accountId);
  const account = await access.db.bankAccount.update({
    where: { id: accountId },
    data: { ...toData(input), ...(input.iban ? { ibanEncrypted: encryptSecret(input.iban), ibanLast4: input.iban.slice(-4) } : {}) },
  });
  await recordAudit({ action: "bank.account.update", userId, companyId: access.company.id, entityType: "BankAccount", entityId: accountId, metadata: { ibanChanged: Boolean(input.iban) }, ...meta });
  // Le solde d'ouverture et sa date déterminent l'écriture d'ouverture et les opérations comptabilisées.
  const transactions = await access.db.bankTransaction.findMany({ where: { bankAccountId: accountId }, select: { id: true } });
  await syncAccountingFor(access.company, [{ type: "OPENING", id: accountId }, ...transactions.map((t) => ({ type: "BANK_TRANSACTION" as const, id: t.id }))]);
  return toView(access, account);
}

export async function setBankAccountActive(access: CompanyAccess, userId: string, accountId: string, isActive: boolean, meta: Meta = {}): Promise<BankAccountView> {
  await getBankAccount(access, accountId);
  const account = await access.db.bankAccount.update({ where: { id: accountId }, data: { isActive } });
  await recordAudit({ action: isActive ? "bank.account.reactivate" : "bank.account.archive", userId, companyId: access.company.id, entityType: "BankAccount", entityId: accountId, ...meta });
  return toView(access, account);
}

/** Un compte ne peut être supprimé que s'il ne porte aucune opération ; sinon il s'archive. */
export async function deleteBankAccount(access: CompanyAccess, userId: string, accountId: string, meta: Meta = {}): Promise<void> {
  const account = await getBankAccount(access, accountId);
  const count = await access.db.bankTransaction.count({ where: { bankAccountId: accountId } });
  if (count > 0) throw errors.conflict("ACCOUNT_HAS_TRANSACTIONS", "Ce compte porte des opérations : archivez-le plutôt que de le supprimer.");
  await access.db.bankAccount.delete({ where: { id: accountId } });
  await recordAudit({ action: "bank.account.delete", userId, companyId: access.company.id, entityType: "BankAccount", entityId: accountId, metadata: { name: account.name }, ...meta });
  await syncAccountingFor(access.company, [{ type: "OPENING", id: accountId }]);
}
