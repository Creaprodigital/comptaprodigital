import type { Company, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import { toIsoDate } from "@/lib/dates";
import { insertEntry, lockCompany, type LineInput } from "./entries";
import { postingDate } from "./fiscal-years";
import { expectedEntryFor, type ExpectedEntry, type SourceRef } from "./postings";
import { REFERENCE_JOURNALS } from "@/config/chart-of-accounts";
import { withTransactionRetry } from "@/server/modules/invoicing/shared";
import { ensureAccountingSetup, isAccountingEnabled, type Tx } from "./setup";

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

/** Synchronise l'écriture d'une pièce (dans une transaction qui détient le verrou de l'entreprise). */
export async function syncSource(tx: Tx, company: CompanyRef, ref: SourceRef): Promise<"unchanged" | "created" | "replaced" | "reversed" | "removed"> {
  const companyId = company.id;
  const expected = await expectedEntryFor(tx, company, ref);
  const existing = (await tx.accountingEntry.findMany({
    where: { companyId, sourceType: ref.type, sourceId: ref.id },
    include: { ...lineInclude, journal: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  })) as ExistingEntry[];

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
            for (const ref of chunk) await syncSource(tx, company, ref);
          },
          { timeout: 120_000, maxWait: 20_000 },
        ),
      );
    }
    // Première utilisation de la comptabilité : reprise de tout l'historique.
    if (fresh) await resyncAll(company);
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

/** Recalcule toutes les écritures automatiques d'une entreprise. */
export async function resyncAll(company: CompanyRef): Promise<{ examined: number; changed: number }> {
  if (!(await isAccountingEnabled(company))) return { examined: 0, changed: 0 };
  const refs = await allSourceRefs(company.id);
  let changed = 0;
  for (let start = 0; start < refs.length; start += 100) {
    const chunk = refs.slice(start, start + 100);
    changed += await withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          await lockCompany(tx, company.id);
          if (start === 0) await ensureAccountingSetup(tx, company.id);
          let count = 0;
          for (const ref of chunk) if ((await syncSource(tx, company, ref)) !== "unchanged") count++;
          return count;
        },
        { timeout: 180_000, maxWait: 20_000 },
      ),
    );
  }
  return { examined: refs.length, changed };
}

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
  if (fresh) await resyncAll(company);
}
