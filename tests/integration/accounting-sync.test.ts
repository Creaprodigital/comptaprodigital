import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { createBankAccount } from "@/server/modules/bank/accounts";
import { listCategories } from "@/server/modules/bank/categories";
import { createManualTransaction, updateTransaction } from "@/server/modules/bank/transactions";
import { BACKFILL_INLINE_LIMIT, dailyAccountingSync, ensureAccountingReady, resyncAll } from "@/server/modules/accounting/sync";
import { bannersFor } from "@/server/billing/banners";
import { bankAccountSchema, manualTransactionSchema } from "@/lib/schemas/bank";
import { addDays, fromIsoDate, todayInParis } from "@/lib/dates";
import { sha256Hex } from "@/server/security/crypto";
import { createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const today = todayInParis();
const d = (n: number) => addDays(today, -n);
let access: CompanyAccess;
let userId: string;
let accountId: string;
let categoryId: string;

const entriesOf = (sourceId: string) => prisma.accountingEntry.count({ where: { companyId: access.company.id, sourceId } });

beforeAll(async () => {
  await resetDatabase();
  const user = await createVerifiedUser({ email: "synchro@exemple.test", plan: "PRO" });
  userId = user.id;
  access = await authorizeCompany(userId, (await createTestCompany(userId, "Synchro SARL")).id, "accounting:write");
  accountId = (await createBankAccount(access, userId, bankAccountSchema.parse({ name: "Compte courant", openingBalance: "1000", openingBalanceDate: d(60) }))).id;
  categoryId = (await listCategories(access.company.id)).find((c) => c.kind === "EXPENSE")!.id;
});

describe("synchronisation quotidienne", () => {
  it("la première utilisation fait la reprise complète ; la passe quotidienne est ensuite incrémentale", async () => {
    const tx = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d(5), label: "CB PAPETERIE", direction: "OUT", amount: "50", categoryId }));
    const markers = await prisma.company.findUniqueOrThrow({ where: { id: access.company.id }, select: { accountingSyncedAt: true, accountingFullSyncAt: true } });
    expect(markers.accountingSyncedAt).not.toBeNull();
    expect(markers.accountingFullSyncAt).not.toBeNull();
    expect((await dailyAccountingSync(access.company)).mode).toBe("incremental");

    // Rien de modifié (au-delà de la marge d'une heure) : la passe incrémentale n'examine rien.
    await prisma.company.update({ where: { id: access.company.id }, data: { accountingSyncedAt: new Date(Date.now() + 2 * 3600_000) } });
    expect(await dailyAccountingSync(access.company)).toMatchObject({ mode: "incremental", examined: 0 });

    // Une pièce modifiée est reprise ; une autre, non modifiée, n'est pas examinée
    // (le compte bancaire, créé à l'instant, est daté dans le passé pour ne pas être repris lui aussi).
    await prisma.bankAccount.update({ where: { id: accountId }, data: { updatedAt: new Date(Date.now() - 86400_000) } });
    await prisma.company.update({ where: { id: access.company.id }, data: { accountingSyncedAt: new Date(Date.now() - 60_000 + 3600_000) } });
    await updateTransaction(access, userId, tx.id, { notes: "Fournitures du trimestre" });
    const incremental = await dailyAccountingSync(access.company);
    expect(incremental.mode).toBe("incremental");
    expect(incremental.examined).toBe(1);
  });

  it("repasse en synchronisation complète après une semaine ou après un échec", async () => {
    const stale = new Date(Date.now() - 8 * 86400_000);
    await prisma.company.update({ where: { id: access.company.id }, data: { accountingFullSyncAt: stale } });
    expect((await dailyAccountingSync(access.company)).mode).toBe("full");

    // Une erreur de synchronisation enregistrée depuis la dernière passe : passe complète.
    await prisma.applicationError.create({ data: { message: "échec simulé", path: `accounting-sync:${access.company.id}` } });
    expect((await dailyAccountingSync(access.company)).mode).toBe("full");
    expect((await dailyAccountingSync(access.company)).mode).toBe("incremental");
  });

  it("la passe complète corrige un écart que la passe incrémentale ne voit pas", async () => {
    const tx = await createManualTransaction(access, userId, manualTransactionSchema.parse({ bankAccountId: accountId, date: d(4), label: "CB LIBRAIRIE", direction: "OUT", amount: "30", categoryId }));
    await resyncAll(access.company);
    // Écart artificiel sur une pièce non modifiée : l'écriture au brouillard a disparu.
    await prisma.accountingEntry.deleteMany({ where: { companyId: access.company.id, sourceId: tx.id, status: "DRAFT" } });
    await prisma.company.update({ where: { id: access.company.id }, data: { accountingSyncedAt: new Date(Date.now() + 2 * 3600_000) } });
    await dailyAccountingSync(access.company);
    expect(await entriesOf(tx.id)).toBe(0);
    await prisma.company.update({ where: { id: access.company.id }, data: { accountingFullSyncAt: new Date(Date.now() - 8 * 86400_000) } });
    await dailyAccountingSync(access.company);
    expect(await entriesOf(tx.id)).toBe(1);
  });
});

describe("reprise de l'historique", () => {
  it("au-delà du seuil, signale la reprise en cours puis la termine (hors requête : immédiatement)", async () => {
    const user = await createVerifiedUser({ email: "historique@exemple.test", plan: "PRO" });
    const company = await createTestCompany(user.id, "Historique SAS");
    const history = await authorizeCompany(user.id, company.id, "accounting:write");
    const bank = await createBankAccount(history, user.id, bankAccountSchema.parse({ name: "Compte", openingBalance: "0", openingBalanceDate: d(400) }));
    // Historique importé avant l'activation de la comptabilité.
    await prisma.accountingEntry.deleteMany({ where: { companyId: company.id } });
    await prisma.accountingJournal.deleteMany({ where: { companyId: company.id } });
    await prisma.accountingAccount.deleteMany({ where: { companyId: company.id } });
    const rows = Array.from({ length: BACKFILL_INLINE_LIMIT + 5 }, (_, i) => {
      const date = d(1 + (i % 300));
      const label = `CB ACHAT ${i}`;
      return { id: `bt${randomBytes(11).toString("hex")}`, companyId: company.id, bankAccountId: bank.id, date: fromIsoDate(date), label, amount: "-12.00", fingerprint: sha256Hex(`${date}|${label}`), status: "CATEGORIZED" as const, categoryId };
    });
    await prisma.bankTransaction.createMany({ data: rows });

    await ensureAccountingReady(history.company);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: { accountingBackfillAt: true, accountingFullSyncAt: true } });
    expect(after.accountingBackfillAt).toBeNull();
    expect(after.accountingFullSyncAt).not.toBeNull();
    expect(await prisma.accountingEntry.count({ where: { companyId: company.id, sourceType: "BANK_TRANSACTION" } })).toBe(rows.length);

    // Pendant une reprise, un bandeau prévient les membres de l'entreprise.
    await prisma.company.update({ where: { id: company.id }, data: { accountingBackfillAt: new Date() } });
    expect((await bannersFor(user.id, company.id)).map((b) => b.id)).toContain("accounting-backfill");
    // Reprise interrompue (redémarrage du serveur) : la tâche quotidienne la refait intégralement.
    expect((await dailyAccountingSync(history.company)).mode).toBe("full");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).accountingBackfillAt).toBeNull();
  }, 120_000);
});
