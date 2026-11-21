import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { createBankAccount, listBankAccounts, updateBankAccount } from "@/server/modules/bank/accounts";
import { createManualTransaction, updateTransaction } from "@/server/modules/bank/transactions";
import { listCategories } from "@/server/modules/bank/categories";
import { bridgeStatus, verifyBridgeSignature } from "@/server/modules/bank/bridge";
import {
  bankSyncAvailable,
  completeBankConnection,
  disconnectBankConnection,
  listBankConnections,
  planWebhook,
  startBankConnection,
  syncAllBankConnections,
  syncBankConnection,
} from "@/server/modules/bank/connections";
import { bankAccountSchema, manualTransactionSchema } from "@/lib/schemas/bank";
import { FakeBridge, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from "../support/fake-bridge";
import { addMember, createTestCompany, createVerifiedUser, prisma, resetDatabase } from "./helpers";

const fake = new FakeBridge();
const saved = { ...process.env };
const KEYS = ["BRIDGE_CLIENT_ID", "BRIDGE_CLIENT_SECRET", "BRIDGE_WEBHOOK_SECRET", "BRIDGE_API_BASE"] as const;
const WEBHOOK_SECRET = "644b2ac3-0797-4ec6-9537-cb5c0af9caf9";

let user: { id: string; email: string };
let access: CompanyAccess;

/** Parcours complet : démarrage, « passage » chez Bridge (création de l'item), retour. */
async function connect(target: CompanyAccess, who: { id: string; email: string }, setup: (userUuid: string) => number, extra: Record<string, string> = {}) {
  const { redirectUrl } = await startBankConnection(target, who, {});
  expect(redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/connect\/session\//);
  const session = fake.sessions.at(-1)!;
  const itemId = setup(session.userUuid);
  return completeBankConnection(who.id, { item_id: String(itemId), user_uuid: session.userUuid, success: "true", source: "connect", context: String(session.body.context), ...extra });
}

function sign(payload: string, secret = WEBHOOK_SECRET) {
  return `v1=${createHmac("sha256", secret).update(payload).digest("hex").toUpperCase()}`;
}

beforeAll(async () => {
  await resetDatabase();
  const base = await fake.start();
  Object.assign(process.env, { BRIDGE_CLIENT_ID: FAKE_CLIENT_ID, BRIDGE_CLIENT_SECRET: FAKE_CLIENT_SECRET, BRIDGE_WEBHOOK_SECRET: WEBHOOK_SECRET, BRIDGE_API_BASE: base });
  resetEnvCache();
  const u = await createVerifiedUser({ email: "banque@exemple.test", plan: "PRO" });
  user = { id: u.id, email: u.email };
  access = await authorizeCompany(user.id, (await createTestCompany(user.id, "Synchro Banque SARL")).id, "bank:write");
});

afterAll(async () => {
  await fake.stop();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
});

describe("client Bridge", () => {
  it("vérifie la signature des webhooks (exemple de la documentation Bridge)", () => {
    const payload = '{"content":{"item_id":1234567890,"status":0,"user_uuid":"9a95b38f-f98b-417a-988b-9d0d584893e7"},"timestamp":1611681789,"type":"TEST_EVENT"}';
    const expected = "FAA8ECAC21DA6405D789C76EDB4003756398E7169DACC3FA70CF5919A81374A8";
    expect(verifyBridgeSignature(payload, `v1=${expected}`, WEBHOOK_SECRET)).toBe(true);
    // Deux secrets actifs (changement de secret) : l'une des signatures suffit.
    expect(verifyBridgeSignature(payload, `v1=${"0".repeat(64)},v1=${expected}`, WEBHOOK_SECRET)).toBe(true);
    // Autre schéma ignoré (déclassement), corps altéré, en-tête absent.
    expect(verifyBridgeSignature(payload, `v0=${expected}`, WEBHOOK_SECRET)).toBe(false);
    expect(verifyBridgeSignature(payload.replace("0,", "1,"), `v1=${expected}`, WEBHOOK_SECRET)).toBe(false);
    expect(verifyBridgeSignature(payload, null, WEBHOOK_SECRET)).toBe(false);
  });

  it("traduit l'état des connexions", () => {
    expect(bridgeStatus(0)).toBe("ACTIVE");
    expect(bridgeStatus(-2)).toBe("SYNCING");
    expect(bridgeStatus(1010)).toBe("ACTION_REQUIRED");
    expect(bridgeStatus(429)).toBe("ACTION_REQUIRED");
    expect(bridgeStatus(1003)).toBe("ERROR");
  });

  it("n'est proposé que lorsque les identifiants Bridge sont configurés", () => {
    expect(bankSyncAvailable()).toBe(true);
    delete process.env.BRIDGE_CLIENT_ID;
    delete process.env.BRIDGE_CLIENT_SECRET;
    resetEnvCache();
    expect(bankSyncAvailable()).toBe(false);
    Object.assign(process.env, { BRIDGE_CLIENT_ID: FAKE_CLIENT_ID, BRIDGE_CLIENT_SECRET: FAKE_CLIENT_SECRET });
    resetEnvCache();
  });
});

describe("connexion et synchronisation", () => {
  let checkingRef: number;
  let itemId: number;
  let cardTx: number;
  let rentTx: number;

  it("connecte la banque, crée les comptes courants et d'épargne et reprend les opérations", async () => {
    const outcome = await connect(access, user, (uuid) => {
      const item = fake.addItem(uuid);
      itemId = item.id;
      const checking = fake.addAccount(item.id, { name: "Compte courant pro", balance: 1234.56, iban: "FR7630006000011234567890189" });
      checkingRef = checking.id;
      const savings = fake.addAccount(item.id, { name: "Livret pro", type: "savings", balance: 5000 });
      fake.addAccount(item.id, { name: "Prêt", type: "loan", balance: 40000 });
      cardTx = fake.addTransaction(checking.id, { amount: -6.92, date: "2026-10-09", clean_description: "CB Papeterie", provider_description: "PAIEMENT PAR CARTE 09/10 PAPETERIE" }).id;
      rentTx = fake.addTransaction(checking.id, { amount: -800, date: "2026-10-05", clean_description: "Loyer bureau", provider_description: "PRLV SEPA LOYER" }).id;
      fake.addTransaction(checking.id, { amount: 2400.1, date: "2026-10-12", clean_description: "Virement client Dupont", provider_description: "VIR SEPA DUPONT" });
      fake.addTransaction(checking.id, { amount: -50, date: "2026-11-30", clean_description: "Prélèvement à venir", future: true });
      fake.addTransaction(savings.id, { amount: 5000, date: "2026-10-01", clean_description: "Versement" });
      return item.id;
    });
    expect(outcome.status).toBe("connected");
    if (outcome.status !== "connected") return;
    expect(outcome.sync).toMatchObject({ accounts: 2, imported: 4, error: null });

    // Le jeton d'accès n'a servi qu'aux appels serveur ; aucune donnée de connexion bancaire n'est stockée.
    const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: outcome.connectionId } });
    expect(connection).toMatchObject({ status: "ACTIVE", providerItemRef: String(itemId), companyId: access.company.id });
    expect(fake.sessions.at(-1)!.body).toMatchObject({ user_email: user.email, account_types: "payment" });
    expect(String(fake.sessions.at(-1)!.body.callback_url)).toMatch(/\/api\/v1\/bank\/bridge\/callback$/);

    const accounts = await listBankAccounts(access);
    expect(accounts.map((a) => a.name).sort()).toEqual(["Compte courant pro", "Livret pro"]);
    const checking = accounts.find((a) => a.name === "Compte courant pro")!;
    // Le solde affiché est celui de la banque : le solde d'ouverture est déduit des opérations reprises.
    expect(checking).toMatchObject({ provider: "AGGREGATOR", balance: "1234.56", providerBalance: "1234.56", ibanMasked: "•••• 0189", transactionCount: 3 });
    expect(checking.openingBalance).toBe("-358.62");
    expect(checking.openingBalanceDate).toBe("2026-10-05");

    const rows = await prisma.bankTransaction.findMany({ where: { bankAccountId: checking.id }, orderBy: { date: "asc" } });
    expect(rows.map((r) => [r.label, r.amount.toFixed(2), r.externalId])).toEqual([
      ["Loyer bureau", "-800.00", `bridge:${rentTx}`],
      ["CB Papeterie", "-6.92", `bridge:${cardTx}`],
      ["Virement client Dupont", "2400.10", expect.stringMatching(/^bridge:\d+$/)],
    ]);
    expect(rows[1].rawLabel).toBe("PAIEMENT PAR CARTE 09/10 PAPETERIE");
    // Comptabilisation au brouillard, comme pour un import de relevé.
    expect(await prisma.accountingEntry.count({ where: { companyId: access.company.id, sourceType: "BANK_TRANSACTION", sourceId: { in: rows.map((r) => r.id) } } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { companyId: access.company.id, action: "bank.connection.created" } })).toBe(1);
  });

  it("reprend ensuite les seules opérations modifiées, sans jamais modifier une opération déjà traitée", async () => {
    const before = fake.requests.length;
    const checking = (await listBankAccounts(access)).find((a) => a.name === "Compte courant pro")!;
    const categoryId = (await listCategories(access.company.id)).find((c) => c.kind === "EXPENSE")!.id;
    const rent = await prisma.bankTransaction.findFirstOrThrow({ where: { externalId: `bridge:${rentTx}` } });
    await updateTransaction(access, user.id, rent.id, { categoryId });

    fake.updateTransaction(cardTx, { clean_description: "CB Papeterie Centrale" });
    fake.updateTransaction(rentTx, { amount: -850 });
    const fresh = fake.addTransaction(checkingRef, { amount: -19.99, date: "2026-11-02", clean_description: "Abonnement logiciel" });
    fake.accounts.find((a) => a.id === checkingRef)!.balance = 1164.57;

    const payload = JSON.stringify({ content: { account_id: checkingRef, item_id: itemId, user_uuid: fake.items.get(itemId)!.userUuid, nb_new_transactions: 1, nb_updated_transactions: 2 }, timestamp: Date.now(), type: "item.account.updated" });
    expect(verifyBridgeSignature(payload, sign(payload), WEBHOOK_SECRET)).toBe(true);
    const task = await planWebhook(JSON.parse(payload));
    expect(task).not.toBeNull();
    await task!();

    // Curseur `since` : seules les opérations modifiées ont été demandées.
    const txRequests = fake.requests.slice(before).filter((r) => r.path === "/v3/aggregation/transactions");
    expect(txRequests.length).toBeGreaterThan(0);
    const card = await prisma.bankTransaction.findFirstOrThrow({ where: { externalId: `bridge:${cardTx}` } });
    expect(card.label).toBe("CB Papeterie Centrale");
    // Opération catégorisée : le nouveau montant annoncé par la banque n'est pas appliqué, il est journalisé.
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: rent.id } })).amount.toFixed(2)).toBe("-800.00");
    expect(await prisma.auditLog.count({ where: { entityId: rent.id, action: "bank.transaction.provider_changed" } })).toBe(1);
    expect(await prisma.bankTransaction.count({ where: { externalId: `bridge:${fresh.id}` } })).toBe(1);
    expect((await listBankAccounts(access)).find((a) => a.id === checking.id)!.providerBalance).toBe("1164.57");
  });

  it("retire une opération supprimée par la banque si elle n'a pas été traitée, la signale sinon", async () => {
    const rent = await prisma.bankTransaction.findFirstOrThrow({ where: { externalId: `bridge:${rentTx}` } });
    fake.updateTransaction(cardTx, { deleted: true });
    fake.updateTransaction(rentTx, { deleted: true });
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: access.company.id } });
    const result = await syncBankConnection(connection.id);
    expect(result).toMatchObject({ removed: 1, flagged: 1, error: null });
    expect(await prisma.bankTransaction.count({ where: { externalId: `bridge:${cardTx}` } })).toBe(0);
    const kept = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: rent.id } });
    expect(kept.notes).toContain("Opération retirée par la banque");
    // Synchronisation suivante : rien de nouveau, rien de signalé deux fois.
    expect(await syncBankConnection(connection.id)).toMatchObject({ imported: 0, removed: 0, flagged: 0 });
  });

  it("suit l'état de la connexion et propose de renouveler l'authentification", async () => {
    fake.items.get(itemId)!.status = 1010;
    fake.items.get(itemId)!.status_code_info = "otp_required";
    fake.items.get(itemId)!.status_code_description = "Veuillez saisir le code reçu de votre banque";
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: access.company.id } });
    const payload = { content: { item_id: itemId, user_uuid: connection.providerUserRef, status_code: 1010, full_refresh: false, refresh_trigger: "scheduler" }, timestamp: Date.now(), type: "item.refreshed" };
    await (await planWebhook(payload))!();
    const [view] = await listBankConnections(access);
    expect(view).toMatchObject({ status: "ACTION_REQUIRED", statusDescription: "Veuillez saisir le code reçu de votre banque" });

    // Renouvellement : session Bridge « gestion d'un item existant ».
    await startBankConnection(access, user, { connectionId: connection.id });
    expect(fake.sessions.at(-1)!.body).toMatchObject({ item_id: itemId });
    expect(fake.sessions.at(-1)!.body.user_email).toBeUndefined();
    fake.items.get(itemId)!.status = 0;
    const outcome = await completeBankConnection(user.id, { item_id: String(itemId), success: "true", context: String(fake.sessions.at(-1)!.body.context) });
    expect(outcome.status).toBe("connected");
    expect((await listBankConnections(access))).toHaveLength(1);
    expect((await listBankConnections(access))[0].status).toBe("ACTIVE");
  });

  it("ignore les webhooks d'une connexion inconnue ou d'un autre utilisateur", async () => {
    expect(await planWebhook({ type: "item.refreshed", content: { item_id: 999, user_uuid: "inconnu" } })).toBeNull();
    expect(await planWebhook({ type: "item.refreshed", content: { item_id: itemId, user_uuid: "autre-utilisateur" } })).toBeNull();
    expect(await planWebhook({ type: "TEST_EVENT", content: { item_id: 1234567890 } })).toBeNull();
  });

  it("le solde d'ouverture saisi par l'utilisateur n'est plus recalculé", async () => {
    const checking = (await listBankAccounts(access)).find((a) => a.name === "Compte courant pro")!;
    await updateBankAccount(access, user.id, checking.id, bankAccountSchema.parse({ name: checking.name, openingBalance: "-300", openingBalanceDate: checking.openingBalanceDate! }));
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: access.company.id } });
    await syncBankConnection(connection.id);
    expect((await listBankAccounts(access)).find((a) => a.id === checking.id)!.openingBalance).toBe("-300.00");
  });

  it("la tâche quotidienne synchronise toutes les connexions actives", async () => {
    fake.addTransaction(checkingRef, { amount: -12, date: "2026-11-03", clean_description: "Parking" });
    expect(await syncAllBankConnections()).toMatchObject({ connections: 1, imported: 1, errors: 0 });
  });

  it("déconnecte la banque : consentement révoqué chez Bridge, comptes et opérations conservés", async () => {
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: access.company.id } });
    const count = await prisma.bankTransaction.count({ where: { companyId: access.company.id } });
    await disconnectBankConnection(access, user.id, connection.id);
    expect(fake.items.has(itemId)).toBe(false);
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } })).status).toBe("REVOKED");
    expect(await listBankConnections(access)).toHaveLength(0);
    expect((await listBankAccounts(access)).every((a) => a.provider === "MANUAL")).toBe(true);
    expect(await prisma.bankTransaction.count({ where: { companyId: access.company.id } })).toBe(count);
  });
});

describe("sécurité du parcours de connexion", () => {
  it("refuse un retour sans jeton valide, pour un autre utilisateur, rejoué ou expiré", async () => {
    const u = await createVerifiedUser({ email: "parcours@exemple.test", plan: "PRO" });
    const who = { id: u.id, email: u.email };
    const company = await authorizeCompany(u.id, (await createTestCompany(u.id, "Parcours SAS")).id, "bank:write");
    const intruder = await createVerifiedUser({ email: "intrus@exemple.test", plan: "PRO" });
    await addMember(company.company.id, intruder.id, "COLLABORATOR");

    await startBankConnection(company, who, {});
    const session = fake.sessions.at(-1)!;
    const item = fake.addItem(session.userUuid);
    fake.addAccount(item.id, { balance: 10 });
    const context = String(session.body.context);
    expect(context).toMatch(/^[A-Za-z0-9]{32}$/);
    // Seule l'empreinte du jeton est conservée.
    expect(await prisma.bankConnectSession.count({ where: { stateHash: context } })).toBe(0);

    expect((await completeBankConnection(who.id, { item_id: String(item.id), success: "true", context: "x".repeat(32) })).status).toBe("invalid");
    expect((await completeBankConnection(intruder.id, { item_id: String(item.id), success: "true", context })).status).toBe("invalid");
    expect((await completeBankConnection(who.id, { user_uuid: session.userUuid })).status).toBe("cancelled");
    expect((await completeBankConnection(who.id, { item_id: String(item.id), success: "true", context })).status).toBe("connected");
    expect((await completeBankConnection(who.id, { item_id: String(item.id), success: "true", context })).status).toBe("invalid");

    await startBankConnection(company, who, {});
    const late = fake.sessions.at(-1)!;
    await prisma.bankConnectSession.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await completeBankConnection(who.id, { item_id: String(item.id), success: "true", context: String(late.body.context) })).status).toBe("expired");

    // Abandon dans le parcours (success=false) : rien n'est créé.
    await startBankConnection(company, who, {});
    const quit = fake.sessions.at(-1)!;
    expect((await completeBankConnection(who.id, { success: "false", step: "bank_creds_form", context: String(quit.body.context) })).status).toBe("cancelled");
    expect(await prisma.bankConnection.count({ where: { companyId: company.company.id } })).toBe(1);
  });

  it("une connexion Bridge ne peut pas être rattachée à une autre entreprise", async () => {
    const u = await createVerifiedUser({ email: "autre@exemple.test", plan: "PRO" });
    const other = await authorizeCompany(u.id, (await createTestCompany(u.id, "Autre SAS")).id, "bank:write");
    const foreign = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: { not: other.company.id }, status: { not: "REVOKED" } } });
    await startBankConnection(other, { id: u.id, email: u.email }, {});
    const session = fake.sessions.at(-1)!;
    // Même si l'identifiant d'un item d'une autre entreprise est substitué dans l'URL de retour, Bridge ne le
    // présente pas à cet utilisateur : rien n'est enregistré.
    expect((await completeBankConnection(u.id, { item_id: foreign.providerItemRef, success: "true", context: String(session.body.context) })).status).toBe("invalid");
    expect(await prisma.bankConnection.count({ where: { companyId: other.company.id } })).toBe(0);
  });
});

describe("compte déjà alimenté par des relevés", () => {
  it("relie le compte de même IBAN et ne reprend pas les opérations antérieures à la dernière importée", async () => {
    const u = await createVerifiedUser({ email: "releves@exemple.test", plan: "PRO" });
    const who = { id: u.id, email: u.email };
    const company = await authorizeCompany(u.id, (await createTestCompany(u.id, "Relevés SARL")).id, "bank:write");
    const manual = await createBankAccount(company, u.id, bankAccountSchema.parse({ name: "Compte importé", iban: "FR1420041010050500013M02606", openingBalance: "100", openingBalanceDate: "2026-09-01" }));
    await createManualTransaction(company, u.id, manualTransactionSchema.parse({ bankAccountId: manual.id, date: "2026-10-10", label: "VIR CLIENT", direction: "IN", amount: "500" }));

    const outcome = await connect(company, who, (uuid) => {
      const item = fake.addItem(uuid);
      const acc = fake.addAccount(item.id, { name: "Compte Bridge", balance: 588, iban: "FR1420041010050500013M02606" });
      fake.addTransaction(acc.id, { amount: -20, date: "2026-10-01", clean_description: "Ancienne opération" });
      fake.addTransaction(acc.id, { amount: 500, date: "2026-10-10", clean_description: "Virement client", provider_description: "VIR CLIENT" });
      fake.addTransaction(acc.id, { amount: -12, date: "2026-10-20", clean_description: "Frais" });
      return item.id;
    });
    expect(outcome.status).toBe("connected");
    const accounts = await listBankAccounts(company);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: manual.id, name: "Compte importé", provider: "AGGREGATOR", openingBalance: "100.00" });
    const rows = await prisma.bankTransaction.findMany({ where: { bankAccountId: manual.id }, orderBy: { date: "asc" } });
    // L'opération du 1er octobre (antérieure à la dernière importée) n'est pas reprise ; celle du 10 octobre est un doublon.
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.amount.toFixed(2)])).toEqual([
      ["2026-10-10", "500.00"],
      ["2026-10-20", "-12.00"],
    ]);
    expect(accounts[0].balance).toBe("588.00");
  });
});
