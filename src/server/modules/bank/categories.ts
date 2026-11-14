import type { CategorizationRule, TransactionCategory } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { Meta } from "@/server/modules/invoicing/shared";
import { toMoneyString } from "@/lib/money";
import type { CategoryInput, RuleInput } from "@/lib/schemas/bank";
import { normalizeLabel } from "./labels";

/**
 * Catégories d'opérations (catégories communes + catégories propres à
 * l'entreprise) et règles automatiques de catégorisation.
 *
 * Les catégories communes n'appartiennent à aucune entreprise (`companyId` NULL) :
 * ce modèle n'est donc pas couvert par le client cloisonné, et chaque requête
 * filtre explicitement sur l'entreprise.
 */

export type CategoryView = { id: string; name: string; kind: TransactionCategory["kind"]; accountNumber: string | null; color: string | null; system: boolean; isActive: boolean };

function toCategoryView(category: TransactionCategory): CategoryView {
  return { id: category.id, name: category.name, kind: category.kind, accountNumber: category.accountNumber, color: category.color, system: category.companyId === null, isActive: category.isActive };
}

export async function listCategories(companyId: string, options: { includeInactive?: boolean } = {}): Promise<CategoryView[]> {
  const categories = await prisma.transactionCategory.findMany({
    where: { OR: [{ companyId: null }, { companyId }], ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return categories.map(toCategoryView);
}

/** Catégorie utilisable par l'entreprise (commune ou propre), active. */
export async function resolveCategory(companyId: string, categoryId: string): Promise<TransactionCategory> {
  const category = await prisma.transactionCategory.findFirst({ where: { id: categoryId, isActive: true, OR: [{ companyId: null }, { companyId }] } });
  if (!category) throw errors.validation([{ path: "categoryId", message: "Catégorie introuvable" }]);
  return category;
}

async function assertNameAvailable(companyId: string, name: string, exceptId?: string) {
  const existing = await listCategories(companyId, { includeInactive: true });
  if (existing.some((c) => c.id !== exceptId && normalizeLabel(c.name) === normalizeLabel(name))) {
    throw errors.validation([{ path: "name", message: "Une catégorie porte déjà ce nom" }]);
  }
}

async function ownCategory(companyId: string, categoryId: string): Promise<TransactionCategory> {
  const category = await prisma.transactionCategory.findFirst({ where: { id: categoryId, companyId } });
  if (!category) throw errors.notFound("Catégorie introuvable ou non modifiable (les catégories communes sont fournies par la plateforme).");
  return category;
}

export async function createCategory(access: CompanyAccess, userId: string, input: CategoryInput, meta: Meta = {}): Promise<CategoryView> {
  const companyId = access.company.id;
  await assertNameAvailable(companyId, input.name);
  const category = await prisma.transactionCategory.create({ data: { companyId, name: input.name, kind: input.kind, accountNumber: input.accountNumber ?? null, color: input.color ?? null } });
  await recordAudit({ action: "bank.category.create", userId, companyId, entityType: "TransactionCategory", entityId: category.id, metadata: { name: category.name }, ...meta });
  return toCategoryView(category);
}

export async function updateCategory(access: CompanyAccess, userId: string, categoryId: string, input: CategoryInput, meta: Meta = {}): Promise<CategoryView> {
  const companyId = access.company.id;
  await ownCategory(companyId, categoryId);
  await assertNameAvailable(companyId, input.name, categoryId);
  const category = await prisma.transactionCategory.update({ where: { id: categoryId }, data: { name: input.name, kind: input.kind, accountNumber: input.accountNumber ?? null, color: input.color ?? null, isActive: true } });
  await recordAudit({ action: "bank.category.update", userId, companyId, entityType: "TransactionCategory", entityId: categoryId, ...meta });
  return toCategoryView(category);
}

/** Une catégorie déjà utilisée est désactivée (les opérations la conservent) ; sinon elle est supprimée. */
export async function deleteCategory(access: CompanyAccess, userId: string, categoryId: string, meta: Meta = {}): Promise<{ deleted: boolean }> {
  const companyId = access.company.id;
  await ownCategory(companyId, categoryId);
  const [transactions, rules] = await Promise.all([access.db.bankTransaction.count({ where: { categoryId } }), access.db.categorizationRule.count({ where: { categoryId } })]);
  if (rules > 0) throw errors.conflict("CATEGORY_HAS_RULES", "Cette catégorie est utilisée par une règle automatique : modifiez ou supprimez d'abord la règle.");
  const deleted = transactions === 0;
  if (deleted) await prisma.transactionCategory.delete({ where: { id: categoryId } });
  else await prisma.transactionCategory.update({ where: { id: categoryId }, data: { isActive: false } });
  await recordAudit({ action: deleted ? "bank.category.delete" : "bank.category.deactivate", userId, companyId, entityType: "TransactionCategory", entityId: categoryId, ...meta });
  return { deleted };
}

// --- Règles automatiques ---------------------------------------------------------------

export type RuleView = {
  id: string;
  name: string;
  matchType: CategorizationRule["matchType"];
  pattern: string;
  direction: "IN" | "OUT" | null;
  amountMin: string | null;
  amountMax: string | null;
  categoryId: string;
  categoryName: string;
  vatRate: string | null;
  priority: number;
  isActive: boolean;
};

type RuleWithCategory = CategorizationRule & { category: { name: string } };

function toRuleView(rule: RuleWithCategory): RuleView {
  return {
    id: rule.id,
    name: rule.name,
    matchType: rule.matchType,
    pattern: rule.pattern,
    direction: rule.direction === "IN" || rule.direction === "OUT" ? rule.direction : null,
    amountMin: rule.amountMin ? toMoneyString(rule.amountMin) : null,
    amountMax: rule.amountMax ? toMoneyString(rule.amountMax) : null,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    vatRate: rule.vatRate ? rule.vatRate.toString() : null,
    priority: rule.priority,
    isActive: rule.isActive,
  };
}

/** Ordre d'évaluation : priorité décroissante, puis ancienneté. La première règle qui correspond l'emporte. */
const RULE_ORDER = [{ priority: "desc" as const }, { createdAt: "asc" as const }];

export async function listRules(access: CompanyAccess): Promise<RuleView[]> {
  const rules = await access.db.categorizationRule.findMany({ include: { category: { select: { name: true } } }, orderBy: RULE_ORDER });
  return rules.map(toRuleView);
}

export async function loadActiveRules(access: CompanyAccess): Promise<CategorizationRule[]> {
  return access.db.categorizationRule.findMany({ where: { isActive: true, matchType: { not: "REGEX" } }, orderBy: RULE_ORDER });
}

async function ruleData(companyId: string, input: RuleInput) {
  await resolveCategory(companyId, input.categoryId);
  return {
    name: input.name,
    matchType: input.matchType ?? "CONTAINS",
    pattern: input.pattern,
    direction: input.direction ?? null,
    amountMin: input.amountMin ?? null,
    amountMax: input.amountMax ?? null,
    categoryId: input.categoryId,
    vatRate: input.vatRate ?? null,
    priority: input.priority ?? 0,
    isActive: input.isActive ?? true,
  };
}

export async function createRule(access: CompanyAccess, userId: string, input: RuleInput, meta: Meta = {}): Promise<RuleView> {
  const companyId = access.company.id;
  if ((await access.db.categorizationRule.count()) >= 200) throw errors.badRequest("TOO_MANY_RULES", "Le nombre de règles est limité à 200.");
  const rule = await access.db.categorizationRule.create({ data: { companyId, ...(await ruleData(companyId, input)) }, include: { category: { select: { name: true } } } });
  await recordAudit({ action: "bank.rule.create", userId, companyId, entityType: "CategorizationRule", entityId: rule.id, metadata: { name: rule.name, pattern: rule.pattern }, ...meta });
  return toRuleView(rule);
}

export async function updateRule(access: CompanyAccess, userId: string, ruleId: string, input: RuleInput, meta: Meta = {}): Promise<RuleView> {
  const companyId = access.company.id;
  if (!(await access.db.categorizationRule.findFirst({ where: { id: ruleId }, select: { id: true } }))) throw errors.notFound("Règle introuvable.");
  const rule = await access.db.categorizationRule.update({ where: { id: ruleId }, data: await ruleData(companyId, input), include: { category: { select: { name: true } } } });
  await recordAudit({ action: "bank.rule.update", userId, companyId, entityType: "CategorizationRule", entityId: ruleId, ...meta });
  return toRuleView(rule);
}

export async function deleteRule(access: CompanyAccess, userId: string, ruleId: string, meta: Meta = {}): Promise<void> {
  const deleted = await access.db.categorizationRule.deleteMany({ where: { id: ruleId } });
  if (deleted.count === 0) throw errors.notFound("Règle introuvable.");
  await recordAudit({ action: "bank.rule.delete", userId, companyId: access.company.id, entityType: "CategorizationRule", entityId: ruleId, ...meta });
}
