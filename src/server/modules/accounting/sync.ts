import type { Company, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import { toIsoDate } from "@/lib/dates";
import { insertEntry, lockCompany, type LineInput } from "./entries";
import { postingDate } from "./fiscal-years";
import { expectedEntryFor, SOURCE_INCLUDES, type ExpectedEntry, type SourceRef } from "./postings";
import { REFERENCE_JOURNALS } from "@/config/chart-of-accounts";
import { withTransactionRetry } from "@/server/modules/invoicing/shared";
import { enableSyncCache, ensureAccountingSetup, isAccountingEnabled, seedMemo, type Tx } from "./setup";

/**
 * Synchronisation des écritures automatiques avec leurs pièces.
 *
 * Pour chaque pièce (facture, règlement, opération bancaire…), l'écriture attendue
 * est recalculée à partir de son état actuel :
 *  - les écritures encore au brouillard sont simplement remplacées ;
 *  - une écriture **validée** n'est jamais modifiée : si elle ne correspond plus à
 *    la pièce, une contre-passation est préparée au brouillard, suivie de la
 *    nouvelle écriture. L'historique comptable reste complet et traçable.
 *
 * Les écritures générées restent au brouillard jusqu'à leur validation par
 * l'utilisateur : rien ne devient définitif automatiquement.
 */

type CompanyRef = Pick<Company, "id" | "fiscalYearStartMonth" | "accountingMode">;

const lineInclude = { lines: { include: { account: { select: { number: true } } }, orderBy: { position: "asc" } } } satisfies Prisma.AccountingEntryInclude;
type ExistingEntry = Prisma.AccountingEntryGetPayload<{ include: typeof lineInclude; }> & { journal: { code: string } };

function signature(journalCode: string, pieceDate: string, lines: Array<{ accountNumber: string; debit: unknown; credit: unknown; auxiliaryNumber?: string | null }>): string {
  const body = lines
    .map((l) => `${l.accountNumber}|${l.auxiliaryNumber ?? ""}|${dec(l.debit as string).toFixed(2)}|${dec(l.credit as string).toFixed(2)}`)
    .sort()
    .join(";");
  return `${journalCode}#${pieceDate}#${body}`;
}

function existingSignature(entry: ExistingEntry): string {
  return signature(
    entry.journal.code,
    entry.pieceDate ? toIsoDate(entry.pieceDate) : toIsoDate(entry.date),
    entry.lines.map((l) => ({ accountNumber: l.account.number, debit: l.debit, credit: l.credit, auxiliaryNumber: l.auxiliaryNumber })),
  );
}

function expectedSignature(expected: ExpectedEntry): string {
  return signature(expected.journalCode, expected.naturalDate, expected.lines);
}

/** Écritures existantes d'un lot de pièces, en une seule requête (clé : « type:id »). */
async function prefetchEntries(tx: Tx, companyId: string, refs: SourceRef[]): Promise<Map<string, ExistingEntry[]>> {
  const rows = (await tx.accountingEntry.findMany({
    where: { companyId, sourceId: { in: [...new Set(refs.map((r) => r.id))] } },
    include: { ...lineInclude, journal: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  })) as ExistingEntry[];
  const map = new Map<string, ExistingEntry[]>(refs.map((r) => [`${r.type}:${r.id}`, []]));
  for (const row of rows) map.get(`${row.sourceType}:${row.sourceId}`)?.push(row);
  return map;
}

/** Charge en une requête par type les pièces d'un lot (mêmes formes que postings.ts) et les dépose dans le cache. */
async function preloadSources(tx: Tx, companyId: string, refs: SourceRef[]): Promise<void> {
  const ids = (type: SourceRef["type"]) => refs.filter((r) => r.type === type).map((r) => r.id);
  const [invoices, payments, purchases, transactions] = await Promise.all([
    ids("INVOICE").length ? tx.invoice.findMany({ where: { companyId, id: { in: ids("INVOICE") } }, include: SOURCE_INCLUDES.INVOICE }) : [],
    ids("PAYMENT").length ? tx.payment.findMany({ where: { companyId, id: { in: ids("PAYMENT") } }, include: SOURCE_INCLUDES.PAYMENT }) : [],
    ids("PURCHASE").length ? tx.purchase.findMany({ where: { companyId, id: { in: ids("PURCHASE") } }, include: SOURCE_INCLUDES.PURCHASE }) : [],
    ids("BANK_TRANSACTION").length ? tx.bankTransaction.findMany({ where: { companyId, id: { in: ids("BANK_TRANSACTION") } }, include: SOURCE_INCLUDES.BANK_TRANSACTION }) : [],
  ]);
  const seed = (type: SourceRef["type"], rows: Array<{ id: string }>) => {
    const found = new Map(rows.map((row) => [row.id, row]));
    // Pièce absente (supprimée) : `null`, comme le ferait findFirst.
    for (const id of ids(type)) seedMemo(tx, `source:${type}:${id}`, found.get(id) ?? null);
  };
  seed("INVOICE", invoices);
  seed("PAYMENT", payments);
  seed("PURCHASE", purchases);
  seed("BANK_TRANSACTION", transactions);
}

/** Synchronise un lot de pièces : cache de lectures de la transaction et écritures existantes préchargées. */
async function syncChunk(tx: Tx, company: CompanyRef, chunk: SourceRef[]): Promise<number> {
  enableSyncCache(tx);
  // Une pièce n'est synchronisée qu'une fois par lot (les écritures préchargées seraient sinon périmées).
  const refs = [...new Map(chunk.map((r) => [`${r.type}:${r.id}`, r])).values()];
  const [existing] = await Promise.all([prefetchEntries(tx, company.id, refs), preloadSources(tx, company.id, refs)]);
  let changed = 0;
  for (const ref of refs) if ((await syncSource(tx, company, ref, existing.get(`${ref.type}:${ref.id}`))) !== "unchanged") changed++;
  return changed;
}

/** Synchronise l'écriture d'une pièce (dans une transaction qui détient le verrou de l'entreprise). */
export async function syncSource(tx: Tx, company: CompanyRef, ref: SourceRef, prefetched?: ExistingEntry[]): Promise<"unchanged" | "created" | "replaced" | "reversed" | "removed"> {
  const companyId = company.id;
  const expected = await expectedEntryFor(tx, company, ref);
  const existing =
    prefetched ??
    ((await tx.accountingEntry.findMany({
      where: { companyId, sourceType: ref.type, sourceId: ref.id },
      include: { ...lineInclude, journal: { select: { code: true } } },
      orderBy: { createdAt: "asc" },
    })) as ExistingEntry[]);

  const drafts = existing.filter((e) => e.status === "DRAFT");
  const validated = existing.filter((e) => e.status === "VALIDATED");
  const reversedIds = new Set(validated.map((e) => e.reversalOfId).filter(Boolean));
  const active = validated.find((e) => !e.reversalOfId && !reversedIds.has(e.id)) ?? null;
  const target = expected ? expectedSignature(expected) : null;

  // Rien à faire si le brouillard contient déjà exactement ce qu'il faut.
  if (active && target && existingSignature(active) === target && drafts.length === 0) return "unchanged";
  if (!active && target && drafts.length === 1 && !drafts[0].reversalOfId && existingSignature(drafts[0]) === target && drafts[0].label === expected!.label) return "unchanged";
  if (!active && !target && drafts.length === 0) return "unchanged";
  // Correction déjà préparée (contre-passation + nouvelle écriture) et toujours d'actualité.
  if (active && existingSignature(active) !== target) {
    const reversal = drafts.find((d) => d.reversalOfId === active.id);
    const replacement = drafts.filter((d) => !d.reversalOfId);
    if (reversal && drafts.length === (target ? 2 : 1) && (!target || (replacement.length === 1 && existingSignature(replacement[0]) === target))) return "unchanged";
  }

  if (drafts.length) await tx.accountingEntry.deleteMany({ where: { companyId, id: { in: drafts.map((d) => d.id) } } });
  if (active && target && existingSignature(active) === target) return "replaced";

  let outcome: "created" | "replaced" | "reversed" | "removed" = drafts.length ? (target ? "replaced" : "removed") : "created";
  if (active) {
    const { date } = await postingDate(tx, company, toIsoDate(active.date));
    const lines: LineInput[] = active.lines.map((l) => ({ accountNumber: l.account.number, label: l.label, debit: l.credit, credit: l.debit, auxiliaryNumber: l.auxiliaryNumber, auxiliaryLabel: l.auxiliaryLabel }));
    await insertEntry(
      tx,
      company,
      { journalCode: active.journal.code, date, label: `Contre-passation de l'écriture n° ${active.entryNumber} — ${active.label}`.slice(0, 255), pieceRef: active.pieceRef, pieceDate: active.pieceDate ? toIsoDate(active.pieceDate) : date, lines },
      { sourceType: ref.type, sourceId: ref.id, reversalOfId: active.id },
    );
    outcome = "reversed";
  }
  if (expected) {
    const { date } = await postingDate(tx, company, expected.naturalDate);
    await insertEntry(tx, company, { journalCode: expected.journalCode, date, label: expected.label, pieceRef: expected.pieceRef, pieceDate: expected.naturalDate, lines: expected.lines }, { sourceType: ref.type, sourceId: ref.id });
  }
  return outcome;
}

/**
 * Point d'entrée appelé après chaque opération métier (émission d'une facture,
 * règlement, catégorisation…). Sans effet si la comptabilité n'est pas tenue en
 * partie double. Une erreur ici ne fait jamais échouer l'opération métier : elle
 * est journalisée et corrigée par la resynchronisation (tâche quotidienne ou
 * bouton « Recalculer »).
 */
export type SourceRefInput = SourceRef;

export async function syncAccountingFor(company: CompanyRef, refs: SourceRef[]): Promise<void> {
  if (refs.length === 0) return;
  try {
    if (!(await isAccountingEnabled(company))) return;
    let fresh = false;
    for (let start = 0; start < refs.length; start += 100) {
      const chunk = refs.slice(start, start + 100);
      // Un interblocage avec une autre opération sur les mêmes lignes est rejoué.
      await withTransactionRetry(() =>
        prisma.$transaction(
          async (tx) => {
            await lockCompany(tx, company.id);
            if (start === 0) fresh = await ensureAccountingSetup(tx, company.id);
            await syncChunk(tx, company, chunk);
          },
          { timeout: 120_000, maxWait: 20_000 },
        ),
      );
    }
    // Première utilisation de la comptabilité : reprise de tout l'historique.
    if (fresh) await backfillHistory(company);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[comptabilité] synchronisation impossible", refs.slice(0, 5), err);
    await prisma.applicationError
      .create({ data: { message: `Comptabilisation automatique : ${err.message}`.slice(0, 5000), stack: err.stack?.slice(0, 20000), path: `accounting-sync:${company.id}` } })
      .catch(() => undefined);
  }
}

/** Toutes les pièces susceptibles de produire une écriture, y compris celles dont l'écriture doit disparaître. */
async function allSourceRefs(companyId: string): Promise<SourceRef[]> {
  const [invoices, payments, purchases, transactions, accounts, depreciations, disposals, vatPeriods, existing] = await Promise.all([
    prisma.invoice.findMany({ where: { companyId, status: { notIn: ["DRAFT", "CANCELLED"] }, number: { not: null } }, select: { id: true } }),
    prisma.payment.findMany({ where: { companyId }, select: { id: true } }),
    prisma.purchase.findMany({ where: { companyId }, select: { id: true } }),
    prisma.bankTransaction.findMany({ where: { companyId }, select: { id: true } }),
    prisma.bankAccount.findMany({ where: { companyId }, select: { id: true } }),
    prisma.fixedAssetDepreciation.findMany({ where: { fixedAsset: { companyId } }, select: { fiscalYearId: true }, distinct: ["fiscalYearId"] }),
    prisma.fixedAsset.findMany({ where: { companyId, status: "DISPOSED" }, select: { id: true } }),
    prisma.vatPeriod.findMany({ where: { companyId }, select: { id: true } }),
    prisma.accountingEntry.findMany({ where: { companyId, sourceType: { notIn: ["MANUAL", "CLOSING"] }, sourceId: { not: null } }, select: { sourceType: true, sourceId: true }, distinct: ["sourceType", "sourceId"] }),
  ]);
  const refs: SourceRef[] = [
    ...accounts.map((r) => ({ type: "OPENING" as const, id: r.id })),
    ...invoices.map((r) => ({ type: "INVOICE" as const, id: r.id })),
    ...payments.map((r) => ({ type: "PAYMENT" as const, id: r.id })),
    ...purchases.map((r) => ({ type: "PURCHASE" as const, id: r.id })),
    ...transactions.map((r) => ({ type: "BANK_TRANSACTION" as const, id: r.id })),
    ...depreciations.map((r) => ({ type: "DEPRECIATION" as const, id: r.fiscalYearId })),
    ...disposals.map((r) => ({ type: "ASSET_DISPOSAL" as const, id: r.id })),
    ...vatPeriods.map((r) => ({ type: "VAT_RETURN" as const, id: r.id })),
    ...existing.map((r) => ({ type: r.sourceType, id: r.sourceId! })),
  ];
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Synchronise une liste de pièces par lots de 100 (une transaction par lot, verrou de l'entreprise). */
async function syncRefs(company: CompanyRef, refs: SourceRef[]): Promise<number> {
  let changed = 0;
  for (let start = 0; start < refs.length; start += 100) {
    const chunk = refs.slice(start, start + 100);
    changed += await withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          await lockCompany(tx, company.id);
          if (start === 0) await ensureAccountingSetup(tx, company.id);
          return syncChunk(tx, company, chunk);
        },
        { timeout: 180_000, maxWait: 20_000 },
      ),
    );
  }
  return changed;
}

/** Recalcule toutes les écritures automatiques d'une entreprise. */
export async function resyncAll(company: CompanyRef): Promise<{ examined: number; changed: number }> {
  if (!(await isAccountingEnabled(company))) return { examined: 0, changed: 0 };
  const startedAt = new Date();
  const refs = await allSourceRefs(company.id);
  const changed = await syncRefs(company, refs);
  await prisma.company.update({ where: { id: company.id }, data: { accountingSyncedAt: startedAt, accountingFullSyncAt: startedAt, accountingBackfillAt: null } });
  return { examined: refs.length, changed };
}

/**
 * Pièces modifiées depuis une date (avec une marge), y compris celles dont le client ou le
 * fournisseur a changé (libellés des comptes auxiliaires). Les autres changements (exercices,
 * paramètres) sont rattrapés par la synchronisation complète hebdomadaire.
 */
async function changedSourceRefs(companyId: string, since: Date): Promise<SourceRef[]> {
  const after = { gte: since };
  const [invoices, payments, purchases, transactions, accounts, vatPeriods, assets] = await Promise.all([
    prisma.invoice.findMany({ where: { companyId, number: { not: null }, OR: [{ updatedAt: after }, { customer: { updatedAt: after } }] }, select: { id: true } }),
    prisma.payment.findMany({ where: { companyId, createdAt: after }, select: { id: true } }),
    prisma.purchase.findMany({ where: { companyId, OR: [{ updatedAt: after }, { supplier: { updatedAt: after } }] }, select: { id: true } }),
    prisma.bankTransaction.findMany({ where: { companyId, updatedAt: after }, select: { id: true } }),
    prisma.bankAccount.findMany({ where: { companyId, updatedAt: after }, select: { id: true } }),
    prisma.vatPeriod.findMany({ where: { companyId, updatedAt: after }, select: { id: true } }),
    prisma.fixedAsset.findMany({ where: { companyId, updatedAt: after }, select: { id: true, status: true, depreciations: { select: { fiscalYearId: true } } } }),
  ]);
  const refs: SourceRef[] = [
    ...accounts.map((r) => ({ type: "OPENING" as const, id: r.id })),
    ...invoices.map((r) => ({ type: "INVOICE" as const, id: r.id })),
    ...payments.map((r) => ({ type: "PAYMENT" as const, id: r.id })),
    ...purchases.map((r) => ({ type: "PURCHASE" as const, id: r.id })),
    ...transactions.map((r) => ({ type: "BANK_TRANSACTION" as const, id: r.id })),
    ...vatPeriods.map((r) => ({ type: "VAT_RETURN" as const, id: r.id })),
    ...[...new Set(assets.flatMap((a) => a.depreciations.map((d) => d.fiscalYearId)))].map((id) => ({ type: "DEPRECIATION" as const, id })),
    ...assets.filter((a) => a.status === "DISPOSED").map((a) => ({ type: "ASSET_DISPOSAL" as const, id: a.id })),
  ];
  return [...new Map(refs.map((r) => [`${r.type}:${r.id}`, r])).values()];
}

const FULL_SYNC_INTERVAL = 7 * 86400_000;
/** Marge de recouvrement de la passe incrémentale (transactions longues, horloges). */
const INCREMENTAL_MARGIN = 3600_000;

/**
 * Filet de sécurité quotidien (chaque opération synchronise déjà ses propres écritures) :
 * passe incrémentale sur les pièces modifiées depuis la dernière passe, et passe complète si la
 * dernière date de plus d'une semaine, si une synchronisation a échoué entre-temps ou si une reprise
 * d'historique a été interrompue.
 */
export async function dailyAccountingSync(company: CompanyRef, now = new Date()): Promise<{ mode: "full" | "incremental" | "disabled"; examined: number; changed: number }> {
  if (!(await isAccountingEnabled(company))) return { mode: "disabled", examined: 0, changed: 0 };
  const markers = await prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: { accountingSyncedAt: true, accountingFullSyncAt: true, accountingBackfillAt: true } });
  const failures = markers.accountingSyncedAt
    ? await prisma.applicationError.count({ where: { path: `accounting-sync:${company.id}`, createdAt: { gte: markers.accountingSyncedAt } } })
    : 0;
  const full = !markers.accountingSyncedAt || !markers.accountingFullSyncAt || now.getTime() - markers.accountingFullSyncAt.getTime() >= FULL_SYNC_INTERVAL || failures > 0 || markers.accountingBackfillAt !== null;
  if (full) return { mode: "full", ...(await resyncAll(company)) };
  const startedAt = new Date();
  const refs = await changedSourceRefs(company.id, new Date(markers.accountingSyncedAt!.getTime() - INCREMENTAL_MARGIN));
  const changed = await syncRefs(company, refs);
  await prisma.company.update({ where: { id: company.id }, data: { accountingSyncedAt: startedAt } });
  return { mode: "incremental", examined: refs.length, changed };
}

/** Au-delà de ce nombre de pièces, la reprise de l'historique se fait en arrière-plan. */
export const BACKFILL_INLINE_LIMIT = 1000;

/**
 * Comptabilité prête à être consultée ou saisie : plan comptable et journaux en
 * place. La vérification est une simple lecture ; l'initialisation, rare, se fait
 * sous le verrou de l'entreprise (pas de créations concurrentes) et reprend alors
 * tout l'historique des pièces.
 */
export async function ensureAccountingReady(company: CompanyRef): Promise<void> {
  const [accounts, journals, bankAccounts, bankJournals] = await Promise.all([
    prisma.accountingAccount.count({ where: { companyId: company.id } }),
    prisma.accountingJournal.count({ where: { companyId: company.id, bankAccountId: null } }),
    prisma.bankAccount.count({ where: { companyId: company.id } }),
    prisma.accountingJournal.count({ where: { companyId: company.id, bankAccountId: { not: null } } }),
  ]);
  if (accounts > 0 && journals >= REFERENCE_JOURNALS.length && bankJournals >= bankAccounts) return;
  const fresh = await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockCompany(tx, company.id);
        return ensureAccountingSetup(tx, company.id);
      },
      { timeout: 30_000, maxWait: 20_000 },
    ),
  );
  if (fresh) await backfillHistory(company);
}

/**
 * Reprise de l'historique à la première utilisation : immédiate pour un volume modeste, sinon
 * après l'envoi de la réponse (la page s'affiche aussitôt, un bandeau signale la reprise en cours ;
 * si le serveur s'arrête avant la fin, la tâche quotidienne la reprend intégralement).
 */
async function backfillHistory(company: CompanyRef): Promise<void> {
  const refs = await allSourceRefs(company.id);
  if (refs.length <= BACKFILL_INLINE_LIMIT) {
    await resyncAll(company);
    return;
  }
  await prisma.company.update({ where: { id: company.id }, data: { accountingBackfillAt: new Date() } });
  const run = () =>
    resyncAll(company).catch(async (error: Error) => {
      console.error("[comptabilité] reprise de l'historique", company.id, error);
      await prisma.applicationError.create({ data: { message: `Reprise de l'historique comptable : ${error.message}`.slice(0, 5000), stack: error.stack?.slice(0, 20000), path: `accounting-sync:${company.id}` } }).catch(() => undefined);
    });
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    // Hors requête (tâches, tests) : exécution immédiate.
    await run();
  }
}
