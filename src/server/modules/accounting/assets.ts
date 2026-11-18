import type { FixedAsset, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { documentHistory, type HistoryEntry, type Meta } from "@/server/modules/invoicing/shared";
import { depreciationPlan, type AssetPlanInput, type PlanPeriod } from "@/lib/depreciation";
import { dec, sum, toMoneyString, ZERO } from "@/lib/money";
import { fromIsoDate, toIsoDate, todayInParis, formatIsoForHumans } from "@/lib/dates";
import type { FixedAssetInput } from "@/lib/schemas/accounting";
import { lockCompany } from "./entries";
import { fiscalYearFor, isOpenFor } from "./fiscal-years";
import { ensureAccount } from "./setup";
import { ensureAccountingReady, syncAccountingFor } from "./sync";

/**
 * Immobilisations et amortissements. Le registre décrit chaque bien et son plan ;
 * les dotations d'un exercice sont calculées puis comptabilisées (écriture
 * d'opérations diverses au brouillard), et la sortie d'un bien (cession, mise au
 * rebut) produit son écriture de sortie.
 */

/** Compte d'amortissement associé à un compte d'immobilisation (218300 → 281830, 205000 → 280500). */
export function depreciationAccountFor(assetAccount: string): string {
  return `28${assetAccount.slice(1, Math.max(5, assetAccount.length - 1))}`.padEnd(6, "0");
}

function planInput(asset: FixedAsset): AssetPlanInput {
  return {
    cost: asset.cost.toString(),
    residualValue: asset.residualValue.toString(),
    method: asset.method,
    durationMonths: asset.durationMonths,
    acquisitionDate: toIsoDate(asset.acquisitionDate),
    serviceDate: toIsoDate(asset.serviceDate),
    disposedAt: asset.disposedAt ? toIsoDate(asset.disposedAt) : null,
  };
}

export type AssetView = {
  id: string;
  label: string;
  assetAccountNumber: string;
  depreciationAccountNumber: string;
  acquisitionDate: string;
  serviceDate: string;
  cost: string;
  residualValue: string;
  method: FixedAsset["method"];
  durationMonths: number;
  status: FixedAsset["status"];
  disposedAt: string | null;
  disposalPrice: string | null;
  cumulated: string;
  netBookValue: string;
  /** Dotations déjà calculées, par exercice. */
  recorded: Array<{ fiscalYearId: string; fiscalYearLabel: string; amount: string; cumulative: string }>;
  plan: Array<{ start: string; end: string; amount: string; cumulative: string; netBookValue: string }>;
};

async function toView(asset: FixedAsset & { depreciations: Array<{ fiscalYearId: string; amount: Decimal.Value; cumulativeAmount: Decimal.Value; fiscalYear: { label: string; startDate: Date } }> }, startMonth: number): Promise<AssetView> {
  const cumulated = sum(asset.depreciations.map((d) => d.amount));
  return {
    id: asset.id,
    label: asset.label,
    assetAccountNumber: asset.assetAccountNumber,
    depreciationAccountNumber: asset.depreciationAccountNumber,
    acquisitionDate: toIsoDate(asset.acquisitionDate),
    serviceDate: toIsoDate(asset.serviceDate),
    cost: toMoneyString(asset.cost),
    residualValue: toMoneyString(asset.residualValue),
    method: asset.method,
    durationMonths: asset.durationMonths,
    status: asset.status,
    disposedAt: asset.disposedAt ? toIsoDate(asset.disposedAt) : null,
    disposalPrice: asset.disposalPrice ? toMoneyString(asset.disposalPrice) : null,
    cumulated: toMoneyString(cumulated),
    netBookValue: toMoneyString(dec(asset.cost).minus(cumulated)),
    recorded: [...asset.depreciations]
      .sort((a, b) => a.fiscalYear.startDate.getTime() - b.fiscalYear.startDate.getTime())
      .map((d) => ({ fiscalYearId: d.fiscalYearId, fiscalYearLabel: d.fiscalYear.label, amount: toMoneyString(d.amount), cumulative: toMoneyString(d.cumulativeAmount) })),
    plan: depreciationPlan(planInput(asset), startMonth).map((r) => ({ start: r.start, end: r.end, amount: toMoneyString(r.amount), cumulative: toMoneyString(r.cumulative), netBookValue: toMoneyString(r.netBookValue) })),
  };
}

const assetInclude = { depreciations: { include: { fiscalYear: { select: { label: true, startDate: true } } } } } satisfies Prisma.FixedAssetInclude;

async function startMonthOf(access: CompanyAccess): Promise<number> {
  const first = await access.db.fiscalYear.findFirst({ orderBy: { startDate: "asc" } });
  return first ? Number(toIsoDate(first.startDate).slice(5, 7)) : access.company.fiscalYearStartMonth;
}

export async function listAssets(access: CompanyAccess): Promise<AssetView[]> {
  const [assets, startMonth] = await Promise.all([access.db.fixedAsset.findMany({ include: assetInclude, orderBy: [{ status: "asc" }, { acquisitionDate: "desc" }] }), startMonthOf(access)]);
  return Promise.all(assets.map((a) => toView(a, startMonth)));
}

async function findAsset(access: CompanyAccess, assetId: string) {
  const asset = await access.db.fixedAsset.findFirst({ where: { id: assetId }, include: assetInclude });
  if (!asset) throw errors.notFound("Immobilisation introuvable.");
  return asset;
}

export async function getAsset(access: CompanyAccess, assetId: string): Promise<AssetView> {
  return toView(await findAsset(access, assetId), await startMonthOf(access));
}

export async function getAssetHistory(access: CompanyAccess, assetId: string): Promise<HistoryEntry[]> {
  await findAsset(access, assetId);
  return documentHistory(access.company.id, "FixedAsset", assetId);
}

function assetData(input: FixedAssetInput) {
  return {
    label: input.label,
    assetAccountNumber: input.assetAccountNumber,
    depreciationAccountNumber: depreciationAccountFor(input.assetAccountNumber),
    expenseAccountNumber: "681100",
    acquisitionDate: fromIsoDate(input.acquisitionDate),
    serviceDate: fromIsoDate(input.serviceDate),
    cost: new Decimal(input.cost).toFixed(2),
    residualValue: new Decimal(input.residualValue).toFixed(2),
    method: input.method,
    durationMonths: input.durationMonths,
  };
}

export async function createAsset(access: CompanyAccess, userId: string, input: FixedAssetInput, meta: Meta = {}): Promise<AssetView> {
  const companyId = access.company.id;
  if (input.acquisitionDate > todayInParis()) throw errors.validation([{ path: "acquisitionDate", message: "La date d'acquisition ne peut pas être dans le futur" }]);
  await ensureAccountingReady(access.company);
  const asset = await prisma.$transaction(async (tx) => {
    const data = assetData(input);
    await ensureAccount(tx, companyId, data.assetAccountNumber, input.label);
    await ensureAccount(tx, companyId, data.depreciationAccountNumber, `Amortissements — ${input.label}`);
    const created = await tx.fixedAsset.create({ data: { companyId, ...data, createdById: userId } });
    await recordAudit({ action: "asset.create", userId, companyId, entityType: "FixedAsset", entityId: created.id, metadata: { detail: `Immobilisation inscrite au registre (${input.cost.replace(".", ",")} €)` }, ...meta }, tx);
    return created;
  });
  return getAsset(access, asset.id);
}

/** Modification possible tant qu'aucune dotation n'a été calculée. */
export async function updateAsset(access: CompanyAccess, userId: string, assetId: string, input: FixedAssetInput, meta: Meta = {}): Promise<AssetView> {
  const asset = await findAsset(access, assetId);
  if (asset.depreciations.length > 0 || asset.status === "DISPOSED") throw errors.conflict("ASSET_DEPRECIATED", "Des dotations ont déjà été calculées pour ce bien : son plan ne peut plus être modifié.");
  await prisma.$transaction(async (tx) => {
    const data = assetData(input);
    await ensureAccount(tx, access.company.id, data.assetAccountNumber, input.label);
    await ensureAccount(tx, access.company.id, data.depreciationAccountNumber, `Amortissements — ${input.label}`);
    await tx.fixedAsset.update({ where: { id: assetId }, data });
    await recordAudit({ action: "asset.update", userId, companyId: access.company.id, entityType: "FixedAsset", entityId: assetId, metadata: { detail: "Fiche de l'immobilisation modifiée" }, ...meta }, tx);
  });
  return getAsset(access, assetId);
}

export async function deleteAsset(access: CompanyAccess, userId: string, assetId: string, meta: Meta = {}): Promise<void> {
  const asset = await findAsset(access, assetId);
  if (asset.depreciations.length > 0 || asset.status === "DISPOSED") throw errors.conflict("ASSET_DEPRECIATED", "Ce bien a déjà fait l'objet de dotations : il ne peut plus être supprimé du registre.");
  await access.db.fixedAsset.delete({ where: { id: assetId } });
  await recordAudit({ action: "asset.delete", userId, companyId: access.company.id, entityType: "FixedAsset", entityId: assetId, metadata: { label: asset.label }, ...meta });
}

/** Dotation prévue d'un bien pour un exercice. */
export function plannedFor(asset: FixedAsset, period: PlanPeriod, startMonth: number): Decimal {
  return depreciationPlan(planInput(asset), startMonth).find((r) => r.start === period.start)?.amount ?? ZERO;
}

/** Biens dont la dotation d'un exercice reste à calculer ou ne correspond plus au plan. */
export async function pendingDepreciations(access: CompanyAccess, fiscalYearId: string): Promise<Array<{ assetId: string; label: string; planned: string; recorded: string | null }>> {
  const fiscalYear = await access.db.fiscalYear.findFirst({ where: { id: fiscalYearId } });
  if (!fiscalYear) throw errors.notFound("Exercice introuvable.");
  const period = { start: toIsoDate(fiscalYear.startDate), end: toIsoDate(fiscalYear.endDate) };
  const startMonth = await startMonthOf(access);
  const assets = await access.db.fixedAsset.findMany({ where: { serviceDate: { lte: fiscalYear.endDate } }, include: { depreciations: { where: { fiscalYearId } } } });
  return assets
    .map((asset) => ({ asset, planned: plannedFor(asset, period, startMonth), recorded: asset.depreciations[0]?.amount ?? null }))
    .filter((r) => !r.planned.isZero() || r.recorded !== null)
    .filter((r) => r.recorded === null || !dec(r.recorded).equals(r.planned))
    .map((r) => ({ assetId: r.asset.id, label: r.asset.label, planned: toMoneyString(r.planned), recorded: r.recorded === null ? null : toMoneyString(r.recorded) }));
}

/** Calcule et comptabilise (au brouillard) les dotations d'un exercice. */
export async function postDepreciations(access: CompanyAccess, userId: string, fiscalYearId: string, meta: Meta = {}): Promise<{ assets: number; total: string }> {
  const companyId = access.company.id;
  const startMonth = await startMonthOf(access);
  const result = await prisma.$transaction(async (tx) => {
    await lockCompany(tx, companyId);
    const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } });
    if (!fiscalYear) throw errors.notFound("Exercice introuvable.");
    const end = toIsoDate(fiscalYear.endDate);
    if (!isOpenFor(fiscalYear, end)) throw errors.conflict("PERIOD_LOCKED", "L'exercice est clôturé ou sa fin est verrouillée : les dotations ne peuvent plus être modifiées.");
    const period = { start: toIsoDate(fiscalYear.startDate), end };
    const assets = await tx.fixedAsset.findMany({ where: { companyId, serviceDate: { lte: fiscalYear.endDate } }, include: { depreciations: { include: { fiscalYear: { select: { startDate: true } } } } } });
    let count = 0;
    let total = ZERO;
    for (const asset of assets) {
      const amount = plannedFor(asset, period, startMonth);
      const previous = sum(asset.depreciations.filter((d) => d.fiscalYear.startDate < fiscalYear.startDate).map((d) => d.amount));
      const existing = asset.depreciations.find((d) => d.fiscalYearId === fiscalYearId);
      if (amount.isZero()) {
        if (existing) await tx.fixedAssetDepreciation.delete({ where: { id: existing.id } });
        continue;
      }
      const cumulative = previous.plus(amount);
      await tx.fixedAssetDepreciation.upsert({
        where: { fixedAssetId_fiscalYearId: { fixedAssetId: asset.id, fiscalYearId } },
        create: { fixedAssetId: asset.id, fiscalYearId, amount: amount.toFixed(2), cumulativeAmount: cumulative.toFixed(2) },
        update: { amount: amount.toFixed(2), cumulativeAmount: cumulative.toFixed(2) },
      });
      const base = dec(asset.cost).minus(dec(asset.residualValue));
      if (asset.status !== "DISPOSED") await tx.fixedAsset.update({ where: { id: asset.id }, data: { status: cumulative.greaterThanOrEqualTo(base) ? "FULLY_DEPRECIATED" : "ACTIVE" } });
      count++;
      total = total.plus(amount);
    }
    await recordAudit({ action: "asset.depreciation", userId, companyId, entityType: "FiscalYear", entityId: fiscalYearId, metadata: { detail: `Dotations de l'exercice calculées (${count} bien(s), ${total.toFixed(2)} €)` }, ...meta }, tx);
    return { assets: count, total: toMoneyString(total) };
  });
  await syncAccountingFor(access.company, [{ type: "DEPRECIATION", id: fiscalYearId }]);
  return result;
}

/** Sortie de l'actif : dotation complémentaire jusqu'à la date de sortie, puis écriture de sortie. */
export async function disposeAsset(access: CompanyAccess, userId: string, assetId: string, input: { date: string; salePrice: string }, meta: Meta = {}): Promise<AssetView> {
  const companyId = access.company.id;
  const asset = await findAsset(access, assetId);
  if (asset.status === "DISPOSED") throw errors.conflict("ASSET_DISPOSED", "Ce bien est déjà sorti de l'actif.");
  if (input.date < toIsoDate(asset.acquisitionDate)) throw errors.validation([{ path: "date", message: "La date de sortie précède l'acquisition" }]);
  if (input.date > todayInParis()) throw errors.validation([{ path: "date", message: "La date de sortie ne peut pas être dans le futur" }]);
  const startMonth = await startMonthOf(access);
  let fiscalYearId = "";
  await prisma.$transaction(async (tx) => {
    await lockCompany(tx, companyId);
    const fiscalYear = await fiscalYearFor(tx, access.company, input.date);
    if (!isOpenFor(fiscalYear, input.date) || !isOpenFor(fiscalYear, toIsoDate(fiscalYear.endDate))) throw errors.validation([{ path: "date", message: "Cette date se trouve dans une période clôturée ou verrouillée." }]);
    fiscalYearId = fiscalYear.id;
    const later = asset.depreciations.filter((d) => d.fiscalYear.startDate > fiscalYear.startDate);
    if (later.length) throw errors.conflict("LATER_DEPRECIATION", "Des dotations existent sur un exercice postérieur à la date de sortie.");
    const disposed = { ...asset, disposedAt: fromIsoDate(input.date) };
    const period = { start: toIsoDate(fiscalYear.startDate), end: toIsoDate(fiscalYear.endDate) };
    const amount = plannedFor(disposed, period, startMonth);
    const previous = sum(asset.depreciations.filter((d) => d.fiscalYear.startDate < fiscalYear.startDate).map((d) => d.amount));
    if (amount.isZero()) await tx.fixedAssetDepreciation.deleteMany({ where: { fixedAssetId: assetId, fiscalYearId } });
    else
      await tx.fixedAssetDepreciation.upsert({
        where: { fixedAssetId_fiscalYearId: { fixedAssetId: assetId, fiscalYearId } },
        create: { fixedAssetId: assetId, fiscalYearId, amount: amount.toFixed(2), cumulativeAmount: previous.plus(amount).toFixed(2) },
        update: { amount: amount.toFixed(2), cumulativeAmount: previous.plus(amount).toFixed(2) },
      });
    await tx.fixedAsset.update({ where: { id: assetId }, data: { status: "DISPOSED", disposedAt: fromIsoDate(input.date), disposalPrice: new Decimal(input.salePrice).toFixed(2) } });
    await recordAudit({ action: "asset.dispose", userId, companyId, entityType: "FixedAsset", entityId: assetId, metadata: { detail: `Sortie de l'actif le ${formatIsoForHumans(input.date)}${new Decimal(input.salePrice).greaterThan(0) ? ` (cession pour ${input.salePrice.replace(".", ",")} €)` : " (mise au rebut)"}` }, ...meta }, tx);
  });
  await syncAccountingFor(access.company, [{ type: "DEPRECIATION", id: fiscalYearId }, { type: "ASSET_DISPOSAL", id: assetId }]);
  return getAsset(access, assetId);
}

export async function assetsCsv(access: CompanyAccess): Promise<string> {
  const assets = await listAssets(access);
  return toCsv(
    ["Intitulé", "Compte", "Acquisition", "Mise en service", "Valeur d'origine", "Valeur résiduelle", "Mode", "Durée (mois)", "Amortissements cumulés", "Valeur nette comptable", "Statut", "Sortie"],
    assets.map((a) => [a.label, a.assetAccountNumber, a.acquisitionDate, a.serviceDate, csvAmount(dec(a.cost)), csvAmount(dec(a.residualValue)), a.method === "LINEAR" ? "Linéaire" : "Dégressif", a.durationMonths, csvAmount(dec(a.cumulated)), csvAmount(dec(a.netBookValue)), { ACTIVE: "En cours", FULLY_DEPRECIATED: "Totalement amorti", DISPOSED: "Sorti" }[a.status], a.disposedAt ?? ""]),
  );
}
