import type { BankAccount, BankConnection, BankConnectionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors, AppError } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { decryptSecret, encryptSecret, generateToken, sha256Hex } from "@/server/security/crypto";
import { withTransactionRetry, type Meta } from "@/server/modules/invoicing/shared";
import { systemAccess } from "@/server/modules/invoicing/sending";
import { syncAccountingFor, type SourceRefInput } from "@/server/modules/accounting/sync";
import { companyHasModule } from "@/server/modules/plans/service";
import { dec, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis } from "@/lib/dates";
import { loadActiveRules } from "./categories";
import { classify } from "./imports";
import { fingerprintTransactions, vatIncluded } from "./labels";
import { matchRule, newTransactionId } from "./transactions";
import { SYNCED_ACCOUNT_TYPES } from "./bridge";
import { getBankDataProvider, type BankDataProvider, type ProviderAccount, type ProviderTransaction } from "./provider";

/**
 * Connexions bancaires par agrégateur (Bridge).
 *
 *  1. L'utilisateur lance la connexion : un parcours Bridge Connect est créé, avec un jeton à usage
 *     unique (paramètre « context ») dont seule l'empreinte est conservée. Il s'authentifie auprès de
 *     sa banque sur les pages de Bridge — la plateforme ne voit jamais ses identifiants.
 *  2. Au retour, le jeton est vérifié (même utilisateur, une heure au plus, une seule fois), la
 *     connexion est enregistrée et une première synchronisation est faite.
 *  3. Ensuite, les webhooks de Bridge (signés) déclenchent la synchronisation des comptes modifiés ;
 *     la tâche quotidienne rattrape un éventuel webhook perdu.
 *
 * Synchronisation d'un compte : opérations modifiées depuis le curseur (`since` = dernier `updated_at`
 * reçu). Les nouvelles opérations passent par la détection des doublons et les règles de catégorisation
 * des imports ; une opération modifiée ou supprimée par la banque n'est mise à jour (ou retirée) que si
 * elle n'a encore fait l'objet d'aucun traitement — sinon le changement est journalisé et signalé, jamais
 * appliqué silencieusement.
 */

const SESSION_TTL_MS = 60 * 60_000;
const EXTERNAL_PREFIX = "bridge:";

export function bankSyncAvailable(): boolean {
  return getBankDataProvider() !== null;
}

function requireProvider(): BankDataProvider {
  const provider = getBankDataProvider();
  if (!provider) throw new AppError(503, "BANK_SYNC_UNAVAILABLE", "La synchronisation bancaire n'est pas configurée sur cette plateforme.");
  return provider;
}

function callbackUrl(): string {
  return new URL("/api/v1/bank/bridge/callback", env().APP_URL).toString();
}

// --- Vues -----------------------------------------------------------------------------------------

export type BankConnectionView = {
  id: string;
  provider: string;
  status: BankConnectionStatus;
  statusDescription: string | null;
  authenticationExpiresAt: string | null;
  /** L'authentification forte expire dans moins de quinze jours : à renouveler. */
  authenticationExpiresSoon: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  accounts: Array<{ id: string; name: string; ibanMasked: string | null; isActive: boolean }>;
  createdAt: string;
};

export async function listBankConnections(access: CompanyAccess): Promise<BankConnectionView[]> {
  const rows = await access.db.bankConnection.findMany({
    where: { status: { not: "REVOKED" } },
    orderBy: { createdAt: "asc" },
    include: { accounts: { select: { id: true, name: true, ibanLast4: true, isActive: true }, orderBy: { createdAt: "asc" } } },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    status: row.status,
    statusDescription: row.statusDescription,
    authenticationExpiresAt: row.authenticationExpiresAt?.toISOString() ?? null,
    authenticationExpiresSoon: row.authenticationExpiresAt !== null && row.authenticationExpiresAt.getTime() - now < 15 * 86400_000,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    accounts: row.accounts.map((a) => ({ id: a.id, name: a.name, ibanMasked: a.ibanLast4 ? `•••• ${a.ibanLast4}` : null, isActive: a.isActive })),
    createdAt: row.createdAt.toISOString(),
  }));
}

// --- Parcours de connexion ------------------------------------------------------------------------

async function knownUserRef(companyId: string, provider: string): Promise<string | null> {
  const previous = await prisma.bankConnection.findFirst({ where: { companyId, provider }, orderBy: { createdAt: "desc" }, select: { providerUserRef: true } });
  return previous?.providerUserRef ?? null;
}

/** Démarre un parcours Bridge Connect : nouvelle connexion, ou renouvellement d'une connexion existante. */
export async function startBankConnection(access: CompanyAccess, user: { id: string; email: string }, input: { connectionId?: string }, meta: Meta = {}): Promise<{ redirectUrl: string }> {
  const provider = requireProvider();
  const companyId = access.company.id;
  let connection: BankConnection | null = null;
  if (input.connectionId) {
    connection = await access.db.bankConnection.findFirst({ where: { id: input.connectionId } });
    if (!connection || connection.status === "REVOKED") throw errors.notFound("Connexion bancaire introuvable.");
  }
  const userRef = connection?.providerUserRef ?? (await provider.ensureUser(companyId, await knownUserRef(companyId, provider.key)));
  // Jeton alphanumérique (format imposé par Bridge pour « context ») ; seule son empreinte est conservée.
  const state = generateToken(24).replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(32, "0");
  const { redirectUrl } = await provider.createConnectSession({ userRef, userEmail: user.email, callbackUrl: callbackUrl(), context: state, itemRef: connection?.providerItemRef });
  await prisma.bankConnectSession.create({ data: { companyId, userId: user.id, provider: provider.key, stateHash: sha256Hex(state), connectionId: connection?.id ?? null, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  await recordAudit({ action: connection ? "bank.connection.reauth_started" : "bank.connection.started", userId: user.id, companyId, entityType: "BankConnection", entityId: connection?.id ?? companyId, metadata: { provider: provider.key }, ...meta });
  return { redirectUrl };
}

export type ConnectOutcome =
  | { status: "connected"; companyId: string; connectionId: string; sync: SyncResult }
  | { status: "cancelled" | "expired" | "invalid"; companyId: string | null };

/**
 * Retour du parcours Bridge Connect. Le jeton « context » rattache le retour à la demande d'origine :
 * sans lui, ou pour un autre utilisateur, rien n'est enregistré.
 */
export async function completeBankConnection(userId: string, params: Record<string, string | undefined>, meta: Meta = {}): Promise<ConnectOutcome> {
  const provider = requireProvider();
  // Parcours quitté avant la fin : Bridge ne renvoie alors que l'identifiant de l'utilisateur.
  if (params.context === undefined) return { status: "cancelled", companyId: null };
  const state = params.context;
  if (!/^[A-Za-z0-9]{32}$/.test(state)) return { status: "invalid", companyId: null };
  const session = await prisma.bankConnectSession.findUnique({ where: { stateHash: sha256Hex(state) } });
  if (!session || session.userId !== userId || session.provider !== provider.key) return { status: "invalid", companyId: null };
  // Usage unique, y compris en cas d'appels simultanés.
  const claimed = await prisma.bankConnectSession.updateMany({ where: { id: session.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) return { status: "invalid", companyId: session.companyId };
  if (session.expiresAt < new Date()) return { status: "expired", companyId: session.companyId };

  const { authorizeBank } = await import("./access");
  const access = await authorizeBank(userId, session.companyId, "bank:write");
  const itemRef = params.item_id && /^\d{1,20}$/.test(params.item_id) ? params.item_id : null;
  if (params.success !== "true" || !itemRef) return { status: "cancelled", companyId: session.companyId };

  const existing = session.connectionId ? await access.db.bankConnection.findFirst({ where: { id: session.connectionId } }) : null;
  const userRef = existing?.providerUserRef ?? (await provider.ensureUser(session.companyId, await knownUserRef(session.companyId, provider.key)));
  const item = await provider.getItem(userRef, itemRef);
  if (!item) return { status: "invalid", companyId: session.companyId };

  // La même connexion (item) ne peut appartenir qu'à une entreprise : celle de l'utilisateur Bridge.
  const owner = await prisma.bankConnection.findUnique({ where: { provider_providerItemRef: { provider: provider.key, providerItemRef: itemRef } } });
  if (owner && owner.companyId !== session.companyId) return { status: "invalid", companyId: session.companyId };
  const data = {
    status: item.status,
    statusCode: item.statusCode,
    statusInfo: item.statusInfo,
    statusDescription: item.statusDescription?.slice(0, 500) ?? null,
    authenticationExpiresAt: item.authenticationExpiresAt,
    revokedAt: null,
    lastError: null,
  };
  const connection = owner
    ? await prisma.bankConnection.update({ where: { id: owner.id }, data })
    : await prisma.bankConnection.create({ data: { companyId: session.companyId, provider: provider.key, providerUserRef: userRef, providerItemRef: itemRef, createdById: userId, ...data } });
  await recordAudit({ action: owner ? "bank.connection.renewed" : "bank.connection.created", userId, companyId: session.companyId, entityType: "BankConnection", entityId: connection.id, metadata: { provider: provider.key, status: item.status }, ...meta });
  const sync = await syncBankConnection(connection.id, { access });
  return { status: "connected", companyId: session.companyId, connectionId: connection.id, sync };
}

// --- Synchronisation ------------------------------------------------------------------------------

export type SyncResult = { accounts: number; imported: number; updated: number; removed: number; flagged: number; error: string | null };

type SyncOptions = { access?: CompanyAccess; accountRefs?: string[] };

/** Synchronise une connexion : état, comptes, puis opérations des comptes autorisés. */
export async function syncBankConnection(connectionId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const provider = requireProvider();
  const result: SyncResult = { accounts: 0, imported: 0, updated: 0, removed: 0, flagged: 0, error: null };
  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === "REVOKED" || connection.provider !== provider.key) return result;
  const access = options.access ?? (await systemAccess(connection.companyId));
  if (!access || access.company.id !== connection.companyId) return result;
  if (!(await companyHasModule(connection.companyId, "bank"))) return result;

  const sources: SourceRefInput[] = [];
  try {
    const item = await provider.getItem(connection.providerUserRef, connection.providerItemRef);
    if (!item) {
      // Connexion supprimée chez Bridge (par l'utilisateur ou au titre du RGPD).
      await revokeLocally(connection, null, "Connexion supprimée chez le prestataire");
      return result;
    }
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: item.status, statusCode: item.statusCode, statusInfo: item.statusInfo, statusDescription: item.statusDescription?.slice(0, 500) ?? null, authenticationExpiresAt: item.authenticationExpiresAt },
    });
    const providerAccounts = await provider.listAccounts(connection.providerUserRef, connection.providerItemRef);
    const linked = await linkAccounts(access, connection, providerAccounts, sources);
    const rules = await loadActiveRules(access);
    const categoryNames = new Map((await prisma.transactionCategory.findMany({ where: { id: { in: rules.map((r) => r.categoryId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    for (const { account, remote } of linked) {
      if (!remote.enabled || !account.isActive) continue;
      if (options.accountRefs && !options.accountRefs.includes(remote.ref)) continue;
      const transactions = await provider.listTransactions(connection.providerUserRef, remote.ref, account.providerCursor);
      const outcome = await ingest(access, account, remote, transactions, rules, categoryNames);
      result.accounts++;
      result.imported += outcome.imported;
      result.updated += outcome.updated;
      result.removed += outcome.removed;
      result.flagged += outcome.flagged;
      sources.push(...outcome.sources);
    }
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date(), lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message.slice(0, 500);
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { lastError: result.error } });
    await prisma.applicationError.create({ data: { message: `Synchronisation bancaire : ${message}`.slice(0, 5000), stack: error instanceof Error ? error.stack?.slice(0, 20000) : undefined, path: `bank-sync:${connection.id}` } }).catch(() => undefined);
  }
  if (sources.length > 0) await syncAccountingFor(access.company, sources);
  return result;
}

/**
 * Rattache les comptes de la connexion : compte déjà connu (même référence), compte saisi
 * manuellement avec le même IBAN (il est relié, son historique importé est conservé), sinon
 * nouveau compte. Seuls les comptes courants et d'épargne sont repris.
 */
async function linkAccounts(access: CompanyAccess, connection: BankConnection, remote: ProviderAccount[], sources: SourceRefInput[]) {
  const linked: Array<{ account: BankAccount; remote: ProviderAccount }> = [];
  for (const ra of remote) {
    if (!SYNCED_ACCOUNT_TYPES.has(ra.type)) continue;
    const balance = ra.balance !== null ? { providerBalance: ra.balance } : {};
    let account = await access.db.bankAccount.findFirst({ where: { providerAccountRef: ra.ref, provider: "AGGREGATOR" } });
    if (account) {
      account = await access.db.bankAccount.update({ where: { id: account.id }, data: { connectionId: connection.id, ...balance } });
      linked.push({ account, remote: ra });
      continue;
    }
    if (!ra.enabled) continue;
    const manual = ra.iban ? await findManualAccountByIban(access, ra.iban) : null;
    if (manual) {
      const last = await access.db.bankTransaction.aggregate({ where: { bankAccountId: manual.id }, _max: { date: true } });
      account = await access.db.bankAccount.update({
        where: { id: manual.id },
        data: { provider: "AGGREGATOR", providerAccountRef: ra.ref, connectionId: connection.id, providerCursor: null, providerSyncFrom: last._max.date ?? null, ...balance },
      });
      await recordAudit({ action: "bank.account.linked", companyId: access.company.id, entityType: "BankAccount", entityId: account.id, metadata: { detail: "Compte relié à la synchronisation bancaire (même IBAN)", connectionId: connection.id } });
    } else {
      account = await access.db.bankAccount.create({
        data: {
          companyId: access.company.id,
          name: ra.name,
          currency: ra.currency,
          ibanEncrypted: ra.iban ? encryptSecret(ra.iban) : null,
          ibanLast4: ra.iban ? ra.iban.slice(-4) : null,
          provider: "AGGREGATOR",
          providerAccountRef: ra.ref,
          connectionId: connection.id,
          openingFromProvider: true,
          ...balance,
        },
      });
      await recordAudit({ action: "bank.account.create", companyId: access.company.id, entityType: "BankAccount", entityId: account.id, metadata: { name: account.name, source: "synchronisation bancaire" } });
      sources.push({ type: "OPENING", id: account.id });
    }
    linked.push({ account, remote: ra });
  }
  return linked;
}

async function findManualAccountByIban(access: CompanyAccess, iban: string): Promise<BankAccount | null> {
  const candidates = await access.db.bankAccount.findMany({ where: { provider: "MANUAL", isActive: true, ibanLast4: iban.slice(-4), ibanEncrypted: { not: null } } });
  return candidates.find((c) => {
    try {
      return decryptSecret(c.ibanEncrypted!).replace(/\s+/g, "").toUpperCase() === iban;
    } catch {
      return false;
    }
  }) ?? null;
}

type IngestOutcome = { imported: number; updated: number; removed: number; flagged: number; sources: SourceRefInput[] };

async function ingest(
  access: CompanyAccess,
  account: BankAccount,
  remote: ProviderAccount,
  transactions: ProviderTransaction[],
  rules: Awaited<ReturnType<typeof loadActiveRules>>,
  categoryNames: Map<string, string>,
): Promise<IngestOutcome> {
  const companyId = access.company.id;
  // Une opération peut figurer plusieurs fois (pagination pendant une mise à jour) : la plus récente fait foi.
  const latest = new Map<string, ProviderTransaction>();
  for (const t of [...transactions].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))) latest.set(t.ref, t);
  const list = [...latest.values()];
  const cursor = list.reduce<string | null>((max, t) => (Number.isFinite(Date.parse(t.updatedAt)) && (!max || Date.parse(t.updatedAt) > Date.parse(max)) ? t.updatedAt : max), account.providerCursor);
  const floor = account.providerSyncFrom ? toIsoDate(account.providerSyncFrom) : null;

  const outcome = await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${account.id} AND companyId = ${companyId} FOR UPDATE`;
        const result: IngestOutcome = { imported: 0, updated: 0, removed: 0, flagged: 0, sources: [] };
        const existing = list.length
          ? await tx.bankTransaction.findMany({
              where: { companyId, bankAccountId: account.id, externalId: { in: list.map((t) => EXTERNAL_PREFIX + t.ref) } },
              select: { id: true, externalId: true, status: true, purchaseId: true, documentCount: true, amount: true, date: true, label: true, notes: true, _count: { select: { payments: true } } },
            })
          : [];
        const known = new Map(existing.map((e) => [e.externalId!, e]));
        const audits: Prisma.AuditLogCreateManyInput[] = [];

        // Opérations déjà reçues : modifiées ou retirées par la banque.
        for (const t of list) {
          const row = known.get(EXTERNAL_PREFIX + t.ref);
          if (!row) continue;
          const untouched = row.status === "TO_REVIEW" && row.purchaseId === null && row.documentCount === 0 && row._count.payments === 0;
          if (t.deleted || t.future || t.currency !== account.currency) {
            if (untouched) {
              await tx.bankTransaction.delete({ where: { id: row.id } });
              audits.push({ action: "bank.transaction.provider_removed", companyId, actorType: "SYSTEM", entityType: "BankTransaction", entityId: row.id, metadata: { detail: "Opération retirée par la banque (synchronisation)", date: toIsoDate(row.date), label: row.label, amount: toMoneyString(row.amount) } });
              result.removed++;
              result.sources.push({ type: "BANK_TRANSACTION", id: row.id });
            } else if (!row.notes?.includes("[Banque] Opération retirée")) {
              await tx.bankTransaction.update({ where: { id: row.id }, data: { notes: `${row.notes ? `${row.notes}\n` : ""}[Banque] Opération retirée par la banque : vérifiez-la avant de la supprimer.` } });
              audits.push({ action: "bank.transaction.provider_removed_kept", companyId, actorType: "SYSTEM", entityType: "BankTransaction", entityId: row.id, metadata: { detail: "Opération retirée par la banque, conservée car déjà traitée" } });
              result.flagged++;
            }
            continue;
          }
          const changed = toIsoDate(row.date) !== t.date || toMoneyString(row.amount) !== t.amount || row.label !== t.label;
          if (!changed) continue;
          if (untouched) {
            await tx.bankTransaction.update({
              where: { id: row.id },
              data: { date: fromIsoDate(t.date), valueDate: t.valueDate ? fromIsoDate(t.valueDate) : null, label: t.label, rawLabel: t.rawLabel, amount: t.amount, fingerprint: fingerprintTransactions([{ ...t, label: t.rawLabel }])[0] },
            });
            result.updated++;
            result.sources.push({ type: "BANK_TRANSACTION", id: row.id });
          } else if (toMoneyString(row.amount) !== t.amount || toIsoDate(row.date) !== t.date) {
            audits.push({ action: "bank.transaction.provider_changed", companyId, actorType: "SYSTEM", entityType: "BankTransaction", entityId: row.id, metadata: { detail: `Modification signalée par la banque, non appliquée (opération déjà traitée) : ${t.date} · ${t.amount}`, date: t.date, amount: t.amount } });
            result.flagged++;
          }
        }

        // Nouvelles opérations : mêmes contrôles de doublons et règles que les imports de relevés.
        const fresh = list.filter((t) => !known.has(EXTERNAL_PREFIX + t.ref) && !t.deleted && !t.future && t.currency === account.currency && (!floor || t.date >= floor));
        // Le libellé brut de la banque (celui des relevés) sert à la détection des doublons et aux règles ;
        // le libellé nettoyé par Bridge est affiché.
        const rows = await classify(tx, companyId, account, fresh.map((t) => ({ date: t.date, valueDate: t.valueDate, label: t.rawLabel, amount: t.amount, externalId: EXTERNAL_PREFIX + t.ref })));
        const clean = new Map(fresh.map((t) => [EXTERNAL_PREFIX + t.ref, t.label]));
        const data = rows
          .filter((row) => row.state !== "duplicate")
          .map((row) => {
            const id = newTransactionId();
            const rule = matchRule(rules, row);
            if (rule) audits.push({ action: "bank.transaction.auto_categorized", companyId, actorType: "SYSTEM", entityType: "BankTransaction", entityId: id, metadata: { detail: `Catégorie « ${categoryNames.get(rule.categoryId) ?? "—"} » appliquée par la règle « ${rule.name} »`, ruleId: rule.id } });
            return {
              id,
              companyId,
              bankAccountId: account.id,
              date: fromIsoDate(row.date),
              valueDate: row.valueDate ? fromIsoDate(row.valueDate) : null,
              label: clean.get(row.externalId!) ?? row.label,
              rawLabel: row.label,
              amount: row.amount,
              currency: account.currency,
              externalId: row.externalId!,
              fingerprint: row.fingerprint,
              isDuplicateSuspect: row.state === "suspect",
              categoryId: rule?.categoryId ?? null,
              vatRate: rule?.vatRate ?? null,
              vatAmount: rule?.vatRate ? vatIncluded(row.amount, rule.vatRate) : null,
              status: rule ? ("CATEGORIZED" as const) : ("TO_REVIEW" as const),
            };
          });
        for (let start = 0; start < data.length; start += 500) await tx.bankTransaction.createMany({ data: data.slice(start, start + 500) });
        result.imported = data.length;
        result.sources.push(...data.map((d) => ({ type: "BANK_TRANSACTION" as const, id: d.id })));
        for (let start = 0; start < audits.length; start += 500) await tx.auditLog.createMany({ data: audits.slice(start, start + 500) });

        // Compte créé par la connexion : le solde d'ouverture est déduit du solde bancaire, de sorte que
        // le solde affiché soit celui de la banque. Il suit l'arrivée de l'historique tant que
        // l'utilisateur ne l'a pas modifié lui-même.
        const opening: Prisma.BankAccountUpdateInput = {};
        if (account.openingFromProvider && remote.balance !== null) {
          const all = await tx.bankTransaction.aggregate({ where: { companyId, bankAccountId: account.id }, _sum: { amount: true }, _min: { date: true } });
          const amount = toMoneyString(dec(remote.balance).minus(dec(all._sum.amount)));
          const date = all._min.date ?? fromIsoDate(todayInParis());
          if (amount !== toMoneyString(account.openingBalance) || account.openingBalanceDate?.getTime() !== date.getTime()) {
            Object.assign(opening, { openingBalance: amount, openingBalanceDate: date });
            result.sources.push({ type: "OPENING", id: account.id });
            // La date d'ouverture détermine les opérations comptabilisées.
            const ids = await tx.bankTransaction.findMany({ where: { companyId, bankAccountId: account.id }, select: { id: true } });
            result.sources.push(...ids.map((r) => ({ type: "BANK_TRANSACTION" as const, id: r.id })));
          }
        }
        await tx.bankAccount.update({ where: { id: account.id }, data: { providerCursor: cursor, lastSyncedAt: new Date(), ...(remote.balance !== null ? { providerBalance: remote.balance } : {}), ...opening } });
        return result;
      },
      { timeout: 120_000, maxWait: 10_000 },
    ),
  );
  outcome.sources = [...new Map(outcome.sources.map((s) => [`${s.type}:${s.id}`, s])).values()];
  return outcome;
}

// --- Révocation -----------------------------------------------------------------------------------

/** Les comptes restent (historique et comptabilité conservés) ; ils repassent en alimentation manuelle. */
async function revokeLocally(connection: BankConnection, userId: string | null, detail: string, meta: Meta = {}) {
  await prisma.$transaction([
    prisma.bankAccount.updateMany({ where: { connectionId: connection.id, companyId: connection.companyId }, data: { provider: "MANUAL", providerAccountRef: null, connectionId: null, providerCursor: null, openingFromProvider: false, providerSyncFrom: null } }),
    prisma.bankConnection.update({ where: { id: connection.id }, data: { status: "REVOKED", revokedAt: new Date() } }),
  ]);
  await recordAudit({ action: "bank.connection.revoked", userId, companyId: connection.companyId, entityType: "BankConnection", entityId: connection.id, metadata: { detail, provider: connection.provider }, ...meta });
}

/** Déconnexion demandée par l'utilisateur : le consentement est révoqué chez Bridge. */
export async function disconnectBankConnection(access: CompanyAccess, userId: string, connectionId: string, meta: Meta = {}): Promise<void> {
  const connection = await access.db.bankConnection.findFirst({ where: { id: connectionId } });
  if (!connection || connection.status === "REVOKED") throw errors.notFound("Connexion bancaire introuvable.");
  const provider = getBankDataProvider();
  if (provider?.key === connection.provider) await provider.deleteItem(connection.providerUserRef, connection.providerItemRef);
  await revokeLocally(connection, userId, "Connexion révoquée par l'utilisateur", meta);
}

/** Entreprise archivée (suppression du compte de son propriétaire) : l'utilisateur Bridge est supprimé. */
export async function revokeCompanyBankConnections(companyId: string): Promise<void> {
  const connections = await prisma.bankConnection.findMany({ where: { companyId, status: { not: "REVOKED" } } });
  if (connections.length === 0) return;
  const provider = getBankDataProvider();
  const users = new Set(connections.filter((c) => c.provider === provider?.key).map((c) => c.providerUserRef));
  for (const userRef of users) await provider!.deleteUser(userRef).catch((error) => console.error("[banque] suppression de l'utilisateur Bridge", error));
  for (const connection of connections) await revokeLocally(connection, null, "Entreprise archivée : consentement révoqué");
}

// --- Webhooks et tâche quotidienne ----------------------------------------------------------------

type WebhookEvent = { type?: string; content?: { item_id?: number | string; user_uuid?: string; account_id?: number | string; status_code?: number; status_code_info?: string; authentication_expires_at?: string } };

/**
 * Événement Bridge déjà authentifié (signature vérifiée). Retourne la tâche à exécuter après la
 * réponse : Bridge attend un accusé de réception rapide.
 */
export async function planWebhook(event: WebhookEvent): Promise<(() => Promise<void>) | null> {
  const provider = getBankDataProvider();
  if (!provider) return null;
  const content = event.content ?? {};
  if (event.type === "user.deleted" && content.user_uuid) {
    const connections = await prisma.bankConnection.findMany({ where: { provider: provider.key, providerUserRef: content.user_uuid, status: { not: "REVOKED" } } });
    return async () => {
      for (const c of connections) await revokeLocally(c, null, "Utilisateur supprimé chez le prestataire");
    };
  }
  if (content.item_id === undefined || !content.user_uuid) return null;
  const connection = await prisma.bankConnection.findUnique({ where: { provider_providerItemRef: { provider: provider.key, providerItemRef: String(content.item_id) } } });
  // Connexion inconnue (parcours abandonné, ou événement rejoué après suppression) ou d'un autre utilisateur : ignoré.
  if (!connection || connection.providerUserRef !== content.user_uuid || connection.status === "REVOKED") return null;
  switch (event.type) {
    case "item.deleted":
      return () => revokeLocally(connection, null, "Connexion supprimée chez le prestataire");
    case "item.refreshed":
    case "item.created":
    case "item.account.created":
      return async () => void (await syncBankConnection(connection.id));
    case "item.account.updated":
    case "item.account.deleted":
      return async () => void (await syncBankConnection(connection.id, content.account_id !== undefined ? { accountRefs: [String(content.account_id)] } : {}));
    default:
      return null;
  }
}

/** Tâche quotidienne : synchronise toutes les connexions actives (rattrapage des webhooks perdus). */
export async function syncAllBankConnections(): Promise<{ connections: number; imported: number; errors: number }> {
  const summary = { connections: 0, imported: 0, errors: 0 };
  if (!bankSyncAvailable()) return summary;
  const connections = await prisma.bankConnection.findMany({ where: { status: { not: "REVOKED" }, company: { status: "ACTIVE" } }, select: { id: true } });
  for (const { id } of connections) {
    const result = await syncBankConnection(id);
    summary.connections++;
    summary.imported += result.imported;
    if (result.error) summary.errors++;
  }
  return summary;
}
