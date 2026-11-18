import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { dec } from "@/lib/money";
import { toIsoDate } from "@/lib/dates";

/**
 * Fichier des écritures comptables (FEC), article A47 A-1 du livre des
 * procédures fiscales : un fichier texte à plat, une ligne par ligne d'écriture
 * validée, 18 zones séparées par une tabulation, première ligne d'en-tête,
 * dates au format AAAAMMJJ, montants avec la virgule comme séparateur décimal,
 * écritures classées dans l'ordre de leur validation. Encodage ISO 8859-15.
 * Nom du fichier : SIREN + « FEC » + date de clôture (AAAAMMJJ).
 *
 * Seules les écritures validées y figurent. La conformité du fichier aux
 * exigences de l'administration doit être vérifiée (outil « Test Compta
 * Demat » de la DGFiP) avant toute remise lors d'un contrôle.
 */

export const FEC_FIELDS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

const LATIN9_SPECIALS: Record<string, number> = { "€": 0xa4, Š: 0xa6, š: 0xa8, Ž: 0xb4, ž: 0xb8, Œ: 0xbc, œ: 0xbd, Ÿ: 0xbe };
const LATIN1_ONLY = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
const REPLACEMENTS: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " ", " ": " ", "•": "-" };

/** Encode une chaîne en ISO 8859-15 ; les caractères non représentables sont translittérés ou remplacés par « ? ». */
export function encodeLatin9(text: string): Buffer {
  const bytes: number[] = [];
  for (const raw of text) {
    const char = REPLACEMENTS[raw] ?? raw;
    for (const c of char) {
      const code = c.codePointAt(0)!;
      if (LATIN9_SPECIALS[c] !== undefined) bytes.push(LATIN9_SPECIALS[c]);
      else if (code < 0x80 || (code >= 0xa0 && code <= 0xff && !LATIN1_ONLY.has(code))) bytes.push(code);
      else {
        const stripped = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
        const first = stripped.codePointAt(0) ?? 0x3f;
        bytes.push(first < 0x80 ? first : 0x3f);
      }
    }
  }
  return Buffer.from(bytes);
}

export function decodeLatin9(buffer: Buffer): string {
  const reverse = new Map(Object.entries(LATIN9_SPECIALS).map(([k, v]) => [v, k]));
  return [...buffer].map((b) => reverse.get(b) ?? String.fromCharCode(b)).join("");
}

const clean = (value: string | null | undefined) => (value ?? "").replace(/[\t\r\n|]+/g, " ").trim();
const fecDate = (date: Date | null | undefined) => (date ? toIsoDate(date).replace(/-/g, "") : "");
const fecAmount = (value: { toString(): string }) => dec(value).toFixed(2).replace(".", ",");

/** Date de validation exprimée à Paris (une validation à 23 h 30 UTC appartient au lendemain). */
function parisDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, "");
}

export async function buildFec(access: CompanyAccess, userId: string, fiscalYearId: string, meta: Meta = {}): Promise<{ fileName: string; content: Buffer; lineCount: number; provisional: boolean }> {
  const companyId = access.company.id;
  const siren = access.company.siren;
  if (!siren) throw errors.badRequest("SIREN_REQUIRED", "Renseignez le numéro SIREN de l'entreprise (Paramètres) : il compose le nom du fichier FEC.");
  const year = await access.db.fiscalYear.findFirst({ where: { id: fiscalYearId } });
  if (!year) throw errors.notFound("Exercice introuvable.");
  const entries = await prisma.accountingEntry.findMany({
    where: { companyId, fiscalYearId, status: "VALIDATED" },
    include: { journal: { select: { code: true, label: true } }, lines: { include: { account: { select: { number: true, label: true } } }, orderBy: { position: "asc" } } },
    orderBy: { entryNumber: "asc" },
  });
  if (entries.length === 0) throw errors.badRequest("NOTHING_TO_EXPORT", "Aucune écriture validée sur cet exercice.");
  const rows: string[] = [FEC_FIELDS.join("\t")];
  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push(
        [
          clean(entry.journal.code),
          clean(entry.journal.label),
          String(entry.entryNumber),
          fecDate(entry.date),
          clean(line.account.number),
          clean(line.account.label),
          clean(line.auxiliaryNumber),
          clean(line.auxiliaryLabel),
          clean(entry.pieceRef) || `E${entry.entryNumber}`,
          fecDate(entry.pieceDate ?? entry.date),
          clean(line.label || entry.label),
          fecAmount(line.debit),
          fecAmount(line.credit),
          clean(line.letter),
          fecDate(line.letteredAt),
          entry.validatedAt ? parisDate(entry.validatedAt) : fecDate(entry.date),
          "",
          "",
        ].join("\t"),
      );
    }
  }
  const content = encodeLatin9(`${rows.join("\r\n")}\r\n`);
  const fileName = `${siren}FEC${fecDate(year.endDate)}.txt`;
  await recordAudit({ action: "accounting.fec_export", userId, companyId, entityType: "FiscalYear", entityId: fiscalYearId, metadata: { detail: `Export FEC (${rows.length - 1} lignes)`, provisional: year.status !== "CLOSED" }, ...meta });
  return { fileName, content, lineCount: rows.length - 1, provisional: year.status !== "CLOSED" };
}

export type FecCheck = { valid: boolean; errors: string[]; lines: number; totalDebit: string; totalCredit: string };

/** Contrôle de structure d'un FEC : 18 zones, formats, équilibre de chaque écriture et du fichier. */
export function checkFec(content: Buffer): FecCheck {
  const text = decodeLatin9(content);
  const lines = text.split("\r\n").filter((l) => l.length > 0);
  const problems: string[] = [];
  if (lines[0] !== FEC_FIELDS.join("\t")) problems.push("En-tête non conforme.");
  const balances = new Map<string, ReturnType<typeof dec>>();
  let debit = dec(0);
  let credit = dec(0);
  lines.slice(1).forEach((line, index) => {
    const cells = line.split("\t");
    const at = `Ligne ${index + 2}`;
    if (cells.length !== 18) {
      problems.push(`${at} : ${cells.length} zones au lieu de 18.`);
      return;
    }
    const [journal, , number, date, account, , , , piece, pieceDate, label, d, c, , dateLet, validDate] = cells;
    if (!journal || !number || !account || !piece || !label) problems.push(`${at} : zone obligatoire vide.`);
    for (const [name, value] of [["EcritureDate", date], ["PieceDate", pieceDate], ["ValidDate", validDate]] as const) if (!/^\d{8}$/.test(value)) problems.push(`${at} : ${name} invalide.`);
    if (dateLet && !/^\d{8}$/.test(dateLet)) problems.push(`${at} : DateLet invalide.`);
    if (!/^\d+,\d{2}$/.test(d) || !/^\d+,\d{2}$/.test(c)) problems.push(`${at} : montant invalide.`);
    const amount = dec(d.replace(",", ".")).minus(dec(c.replace(",", ".")));
    balances.set(`${journal}|${number}`, (balances.get(`${journal}|${number}`) ?? dec(0)).plus(amount));
    debit = debit.plus(dec(d.replace(",", ".")));
    credit = credit.plus(dec(c.replace(",", ".")));
  });
  for (const [key, balance] of balances) if (!balance.isZero()) problems.push(`Écriture ${key.replace("|", " n° ")} déséquilibrée.`);
  if (!debit.equals(credit)) problems.push("Le total des débits diffère du total des crédits.");
  return { valid: problems.length === 0, errors: problems.slice(0, 50), lines: lines.length - 1, totalDebit: debit.toFixed(2), totalCredit: credit.toFixed(2) };
}
