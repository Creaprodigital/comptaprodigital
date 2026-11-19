import type { Company, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { accountTypeFor, REFERENCE_ACCOUNTS, REFERENCE_JOURNALS } from "@/config/chart-of-accounts";
import { companyHasModule } from "@/server/modules/plans/service";

export type Tx = Prisma.TransactionClient;

/**
 * Cache de lectures limité à une transaction de synchronisation (activé explicitement par
 * `enableSyncCache`) : journaux, comptes, exercices et comptes bancaires ne changent pas
 * pendant une synchronisation, qui détient le verrou de l'entreprise. Hors synchronisation,
 * aucune valeur n'est mise en cache.
 */
const syncCaches = new WeakMap<object, Map<string, Promise<unknown>>>();

export function enableSyncCache(tx: Tx): void {
  if (!syncCaches.has(tx)) syncCaches.set(tx, new Map());
}

/** Dépose une valeur déjà lue (préchargement d'un lot) dans le cache de la transaction. */
export function seedMemo(tx: Tx, key: string, value: unknown): void {
  syncCaches.get(tx)?.set(key, Promise.resolve(value));
}

export function memo<T>(tx: Tx, key: string, compute: () => Promise<T>): Promise<T> {
  const cache = syncCaches.get(tx);
  if (!cache) return compute();
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as Promise<T>;
}

/**
 * La comptabilité en partie double concerne les entreprises qui tiennent une
 * comptabilité d'engagement et dont la formule inclut le module « accounting ».
 * Les micro-entreprises tiennent un livre des recettes (voir cash-book.ts).
 */
export async function isAccountingEnabled(company: Pick<Company, "id" | "accountingMode">): Promise<boolean> {
  return company.accountingMode === "DOUBLE_ENTRY" && (await companyHasModule(company.id, "accounting"));
}

/**
 * Prépare la comptabilité d'une entreprise (idempotent) : plan comptable de
 * référence, journaux, un journal et un compte 512 par compte bancaire.
 * Retourne `true` si la comptabilité vient d'être initialisée.
 */
export async function ensureAccountingSetup(tx: Tx, companyId: string): Promise<boolean> {
  const existing = await tx.accountingAccount.count({ where: { companyId } });
  if (existing === 0) {
    await tx.accountingAccount.createMany({
      data: REFERENCE_ACCOUNTS.map((a) => ({ companyId, number: a.number, label: a.label, type: a.type, isSystem: true })),
      skipDuplicates: true,
    });
  }
  await tx.accountingJournal.createMany({
    data: REFERENCE_JOURNALS.map((j) => ({ companyId, code: j.code, label: j.label, type: j.type })),
    skipDuplicates: true,
  });
  await ensureBankJournals(tx, companyId);
  return existing === 0;
}

/** Un journal « BQn » et un compte « 512n00 » par compte bancaire. */
export async function ensureBankJournals(tx: Tx, companyId: string): Promise<void> {
  const accounts = await tx.bankAccount.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
  const journals = await tx.accountingJournal.findMany({ where: { companyId, type: "BANK", bankAccountId: { not: null } } });
  const usedNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean));
  for (const [index, account] of accounts.entries()) {
    let number = account.accountNumber;
    if (!number) {
      // 512000 pour le premier compte, puis 512010, 512020…
      for (let n = index; ; n++) {
        const candidate = n === 0 ? "512000" : `512${String(n).padStart(2, "0")}0`;
        if (!usedNumbers.has(candidate)) {
          number = candidate;
          break;
        }
      }
      usedNumbers.add(number);
      await tx.bankAccount.update({ where: { id: account.id }, data: { accountNumber: number } });
    }
    await ensureAccount(tx, companyId, number, `Banque — ${account.name}`);
    if (!journals.some((j) => j.bankAccountId === account.id)) {
      let code = `BQ${index + 1}`;
      for (let n = index + 1; await tx.accountingJournal.findFirst({ where: { companyId, code } }); n++) code = `BQ${n + 1}`;
      await tx.accountingJournal.create({ data: { companyId, code, label: `Banque — ${account.name}`.slice(0, 100), type: "BANK", bankAccountId: account.id } });
    }
  }
}

/** Identifiant d'un compte, créé à la volée s'il n'existe pas (compte d'une catégorie personnalisée, par exemple). */
export async function ensureAccount(tx: Tx, companyId: string, number: string, label: string): Promise<string> {
  return memo(tx, `account:${companyId}:${number}`, () => findOrCreateAccount(tx, companyId, number, label));
}

async function findOrCreateAccount(tx: Tx, companyId: string, number: string, label: string): Promise<string> {
  const found = await tx.accountingAccount.findUnique({ where: { companyId_number: { companyId, number } }, select: { id: true } });
  if (found) return found.id;
  const created = await tx.accountingAccount.upsert({
    where: { companyId_number: { companyId, number } },
    create: { companyId, number, label: label.slice(0, 191), type: accountTypeFor(number) },
    update: {},
    select: { id: true },
  });
  return created.id;
}

/** Initialise la comptabilité hors transaction applicative. */
export async function setupAccounting(companyId: string): Promise<boolean> {
  return prisma.$transaction((tx) => ensureAccountingSetup(tx, companyId), { timeout: 30_000 });
}
