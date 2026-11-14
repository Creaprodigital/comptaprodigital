import type { BankAccount, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { sha256Hex } from "@/server/security/crypto";
import { withTransactionRetry, type Meta } from "@/server/modules/invoicing/shared";
import { MAX_STATEMENT_BYTES, formatFileSize } from "@/lib/bank";
import { sum, toMoneyString } from "@/lib/money";
import { fromIsoDate, toIsoDate } from "@/lib/dates";
import { getBankAccount } from "./accounts";
import { loadActiveRules } from "./categories";
import { fingerprintTransactions, vatIncluded } from "./labels";
import { analyzeStatement, StatementParseError, type CsvMapping, type ParsedTransaction, type ParseIssue, type StatementFormat, type StatementPreview } from "./parsers";
import { matchRule, newTransactionId } from "./transactions";

/**
 * Import de relevés bancaires (CSV, OFX, camt.053), en deux temps : un aperçu
 * (format reconnu, colonnes, opérations nouvelles et doublons), puis l'import.
 * Le fichier est ré-analysé à l'import : rien n'est conservé entre les deux étapes.
 */

export type ImportInput = { bankAccountId: string; fileName: string; bytes: Buffer; mapping?: CsvMapping };

type RowState = "new" | "duplicate" | "suspect";
type ClassifiedRow = ParsedTransaction & { fingerprint: string; state: RowState };

type DbClient = Prisma.TransactionClient | typeof prisma;

function analyze(input: ImportInput): StatementPreview {
  if (input.bytes.length === 0) throw errors.badRequest("EMPTY_FILE", "Le fichier est vide.");
  if (input.bytes.length > MAX_STATEMENT_BYTES) throw errors.badRequest("FILE_TOO_LARGE", `Relevé trop volumineux (${formatFileSize(MAX_STATEMENT_BYTES)} au maximum) : importez-le par périodes plus courtes.`);
  if (input.bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    throw errors.badRequest("STATEMENT_UNREADABLE", "Un relevé au format PDF ne peut pas être importé : téléchargez-le depuis votre banque au format CSV, OFX ou camt.053.");
  }
  try {
    return analyzeStatement(input.bytes, input.mapping);
  } catch (error) {
    if (error instanceof StatementParseError) throw errors.badRequest("STATEMENT_UNREADABLE", error.message);
    throw error;
  }
}

/**
 * Classe chaque opération du fichier par rapport au compte :
 *  - doublon : même référence bancaire, ou même empreinte (date, montant, libellé, rang) → ignorée ;
 *  - doublon suspecté : une opération de même date et de même montant existe déjà, sous un autre
 *    libellé → importée et signalée, l'utilisateur tranche ;
 *  - nouvelle.
 */
async function classify(db: DbClient, companyId: string, account: BankAccount, transactions: ParsedTransaction[]): Promise<ClassifiedRow[]> {
  if (transactions.length === 0) return [];
  const fingerprints = fingerprintTransactions(transactions);
  const dates = transactions.map((t) => t.date).sort();
  const externalIds = [...new Set(transactions.map((t) => t.externalId).filter((v): v is string => !!v))];
  const [inPeriod, byReference] = await Promise.all([
    db.bankTransaction.findMany({
      where: { companyId, bankAccountId: account.id, date: { gte: fromIsoDate(dates[0]), lte: fromIsoDate(dates.at(-1)!) } },
      select: { fingerprint: true, externalId: true, date: true, amount: true },
    }),
    externalIds.length ? db.bankTransaction.findMany({ where: { companyId, bankAccountId: account.id, externalId: { in: externalIds } }, select: { externalId: true } }) : [],
  ]);
  const knownFingerprints = new Set(inPeriod.map((t) => t.fingerprint));
  const knownReferences = new Set([...inPeriod, ...byReference].map((t) => t.externalId).filter(Boolean));
  const knownDayAmounts = new Set(inPeriod.map((t) => `${toIsoDate(t.date)}|${toMoneyString(t.amount)}`));
  return transactions.map((transaction, index) => {
    const fingerprint = fingerprints[index];
    const duplicate = (transaction.externalId !== undefined && knownReferences.has(transaction.externalId)) || knownFingerprints.has(fingerprint);
    const state: RowState = duplicate ? "duplicate" : knownDayAmounts.has(`${transaction.date}|${transaction.amount}`) ? "suspect" : "new";
    return { ...transaction, fingerprint, state };
  });
}

function assertCurrency(account: BankAccount, currency: string | undefined) {
  if (currency && currency.toUpperCase() !== account.currency) {
    throw errors.badRequest("CURRENCY_MISMATCH", `Ce relevé est libellé en ${currency.toUpperCase()}, alors que le compte est tenu en ${account.currency}.`);
  }
}

export type ImportPreview = {
  format: StatementFormat;
  fileName: string;
  /** CSV : colonnes du fichier et correspondance proposée, à confirmer. */
  csv: { headers: string[]; mapping: Partial<CsvMapping>; sampleRows: string[][] } | null;
  /** `false` tant que la correspondance des colonnes d'un CSV est incomplète. */
  ready: boolean;
  total: number;
  newCount: number;
  duplicateCount: number;
  suspectCount: number;
  issueCount: number;
  issues: ParseIssue[];
  period: { from: string; to: string } | null;
  totalIn: string;
  totalOut: string;
  sample: Array<{ date: string; label: string; amount: string; state: RowState }>;
  /** Ce même fichier a déjà été importé sur ce compte. */
  alreadyImportedAt: string | null;
  /** L'IBAN lu dans le fichier ne correspond pas à celui du compte choisi. */
  accountMismatch: boolean;
};

export async function previewImport(access: CompanyAccess, input: ImportInput): Promise<ImportPreview> {
  const account = await getBankAccount(access, input.bankAccountId);
  const preview = analyze(input);
  const statement = preview.statement;
  assertCurrency(account, statement?.currency);
  const rows = statement ? await classify(prisma, access.company.id, account, statement.transactions) : [];
  const fresh = rows.filter((row) => row.state !== "duplicate");
  const dates = rows.map((row) => row.date).sort();
  const previous = await access.db.bankImport.findFirst({ where: { bankAccountId: account.id, fileChecksum: sha256Hex(input.bytes) }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const fileIban = statement?.accountRef?.replace(/\s/g, "").toUpperCase();
  return {
    format: preview.format,
    fileName: input.fileName,
    csv: preview.csv ?? null,
    ready: statement !== null,
    total: rows.length,
    newCount: fresh.length,
    duplicateCount: rows.length - fresh.length,
    suspectCount: rows.filter((row) => row.state === "suspect").length,
    issueCount: statement?.issues.length ?? 0,
    issues: statement?.issues.slice(0, 50) ?? [],
    period: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    totalIn: toMoneyString(sum(fresh.filter((row) => !row.amount.startsWith("-")).map((row) => row.amount))),
    totalOut: toMoneyString(sum(fresh.filter((row) => row.amount.startsWith("-")).map((row) => row.amount))),
    sample: rows.slice(0, 15).map((row) => ({ date: row.date, label: row.label, amount: row.amount, state: row.state })),
    alreadyImportedAt: previous?.createdAt.toISOString() ?? null,
    accountMismatch: Boolean(fileIban && /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(fileIban) && account.ibanLast4 && !fileIban.endsWith(account.ibanLast4)),
  };
}

export type ImportResult = { importId: string | null; importedCount: number; duplicateCount: number; suspectCount: number; categorizedCount: number; issueCount: number };

export async function commitImport(access: CompanyAccess, userId: string, input: ImportInput, meta: Meta = {}): Promise<ImportResult> {
  const companyId = access.company.id;
  const account = await getBankAccount(access, input.bankAccountId);
  if (!account.isActive) throw errors.badRequest("ACCOUNT_ARCHIVED", "Ce compte est archivé : réactivez-le pour y importer un relevé.");
  const preview = analyze(input);
  const statement = preview.statement;
  if (!statement) throw errors.validation([{ path: "mapping", message: "Indiquez les colonnes de la date, du libellé et du montant" }]);
  assertCurrency(account, statement.currency);
  const rules = await loadActiveRules(access);
  const categories = new Map((await prisma.transactionCategory.findMany({ where: { id: { in: rules.map((r) => r.categoryId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        // Verrou sur le compte : deux imports simultanés du même relevé ne créent pas de doublons.
        await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${account.id} AND companyId = ${companyId} FOR UPDATE`;
        const rows = await classify(tx, companyId, account, statement.transactions);
        const fresh = rows.filter((row) => row.state !== "duplicate");
        const result: ImportResult = {
          importId: null,
          importedCount: fresh.length,
          duplicateCount: rows.length - fresh.length,
          suspectCount: fresh.filter((row) => row.state === "suspect").length,
          categorizedCount: 0,
          issueCount: statement.issues.length,
        };
        if (fresh.length === 0) return result;

        const bankImport = await tx.bankImport.create({
          data: { companyId, bankAccountId: account.id, format: preview.format, fileName: input.fileName.slice(0, 255), fileChecksum: sha256Hex(input.bytes), rowCount: rows.length, importedCount: fresh.length, duplicateCount: result.duplicateCount, createdById: userId },
        });
        const audits: Prisma.AuditLogCreateManyInput[] = [];
        const data = fresh.map((row) => {
          const id = newTransactionId();
          const rule = matchRule(rules, row);
          if (rule) {
            result.categorizedCount++;
            audits.push({ action: "bank.transaction.auto_categorized", companyId, actorType: "SYSTEM", entityType: "BankTransaction", entityId: id, metadata: { detail: `Catégorie « ${categories.get(rule.categoryId) ?? "—"} » appliquée par la règle « ${rule.name} »`, ruleId: rule.id } });
          }
          return {
            id,
            companyId,
            bankAccountId: account.id,
            importId: bankImport.id,
            date: fromIsoDate(row.date),
            valueDate: row.valueDate ? fromIsoDate(row.valueDate) : null,
            label: row.label,
            rawLabel: row.label,
            amount: row.amount,
            currency: account.currency,
            externalId: row.externalId ?? null,
            fingerprint: row.fingerprint,
            isDuplicateSuspect: row.state === "suspect",
            categoryId: rule?.categoryId ?? null,
            vatRate: rule?.vatRate ?? null,
            vatAmount: rule?.vatRate ? vatIncluded(row.amount, rule.vatRate) : null,
            status: rule ? ("CATEGORIZED" as const) : ("TO_REVIEW" as const),
          };
        });
        for (let start = 0; start < data.length; start += 500) await tx.bankTransaction.createMany({ data: data.slice(start, start + 500) });
        for (let start = 0; start < audits.length; start += 500) await tx.auditLog.createMany({ data: audits.slice(start, start + 500) });
        await recordAudit(
          { action: "bank.import", userId, companyId, entityType: "BankImport", entityId: bankImport.id, metadata: { fileName: bankImport.fileName, format: preview.format, imported: fresh.length, duplicates: result.duplicateCount, suspects: result.suspectCount }, ...meta },
          tx,
        );
        return { ...result, importId: bankImport.id };
      },
      { timeout: 60_000, maxWait: 10_000 },
    ),
  );
}

export type ImportView = { id: string; accountId: string; accountName: string; format: StatementFormat; fileName: string; rowCount: number; importedCount: number; duplicateCount: number; remainingCount: number; createdAt: string; createdBy: string | null };

export async function listImports(access: CompanyAccess): Promise<ImportView[]> {
  const imports = await access.db.bankImport.findMany({ include: { bankAccount: { select: { name: true } }, _count: { select: { transactions: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(imports.map((i) => i.createdById).filter((v): v is string => !!v))] } }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  return imports.map((i) => ({
    id: i.id,
    accountId: i.bankAccountId,
    accountName: i.bankAccount.name,
    format: i.format,
    fileName: i.fileName,
    rowCount: i.rowCount,
    importedCount: i.importedCount,
    duplicateCount: i.duplicateCount,
    remainingCount: i._count.transactions,
    createdAt: i.createdAt.toISOString(),
    createdBy: i.createdById ? (names.get(i.createdById) ?? null) : null,
  }));
}

/** Annule un import : ses opérations sont retirées, sauf si l'une d'elles est déjà rapprochée d'une facture. */
export async function deleteImport(access: CompanyAccess, userId: string, importId: string, meta: Meta = {}): Promise<{ deleted: number }> {
  const companyId = access.company.id;
  const bankImport = await access.db.bankImport.findFirst({ where: { id: importId } });
  if (!bankImport) throw errors.notFound("Import introuvable.");
  return prisma.$transaction(async (tx) => {
    const transactions = await tx.bankTransaction.findMany({ where: { companyId, importId }, select: { id: true, _count: { select: { payments: true } } } });
    if (transactions.some((t) => t._count.payments > 0)) {
      throw errors.conflict("IMPORT_RECONCILED", "Des opérations de cet import sont rapprochées de factures : annulez d'abord ces rapprochements.");
    }
    const ids = transactions.map((t) => t.id);
    await tx.documentLink.deleteMany({ where: { companyId, entityType: "BANK_TRANSACTION", entityId: { in: ids } } });
    await tx.bankTransaction.deleteMany({ where: { companyId, importId } });
    await tx.bankImport.deleteMany({ where: { id: importId, companyId } });
    await recordAudit({ action: "bank.import.delete", userId, companyId, entityType: "BankImport", entityId: importId, metadata: { fileName: bankImport.fileName, deleted: ids.length }, ...meta }, tx);
    return { deleted: ids.length };
  });
}
