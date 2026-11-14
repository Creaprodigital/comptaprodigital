import type { Prisma, Product, VatRate } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import type { ProductInput } from "@/lib/schemas/invoicing";

type Meta = { ip?: string | null; userAgent?: string | null };

export type ProductView = ReturnType<typeof serializeProduct>;

export function serializeProduct(product: Product) {
  return {
    id: product.id,
    type: product.type,
    reference: product.reference,
    name: product.name,
    description: product.description,
    unit: product.unit,
    unitPriceExclTax: product.unitPriceExclTax.toFixed(4).replace(/0{1,2}$/, ""),
    vatRate: product.vatRate.toFixed(2),
    isActive: product.isActive,
  };
}

/** En franchise en base, aucun article ne peut porter de TVA. */
function assertVatAllowed(access: CompanyAccess, vatRate: string) {
  if (access.company.vatRegime === "FRANCHISE" && Number(vatRate) !== 0) {
    throw errors.validation([{ path: "vatRate", message: "En franchise en base de TVA, le taux doit être de 0 %" }]);
  }
}

export async function listProducts(access: CompanyAccess, options: { q?: string; page?: number; pageSize?: number; archived?: boolean } = {}) {
  const { q, page = 1, pageSize = 25, archived = false } = options;
  const where: Prisma.ProductWhereInput = {
    isActive: !archived,
    ...(q ? { OR: [{ name: { contains: q } }, { reference: { contains: q } }, { description: { contains: q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    access.db.product.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    access.db.product.count({ where }),
  ]);
  return { items: items.map(serializeProduct), total, page, pageSize };
}

export async function getProduct(access: CompanyAccess, productId: string): Promise<Product> {
  const product = await access.db.product.findFirst({ where: { id: productId } });
  if (!product) throw errors.notFound("Article introuvable.");
  return product;
}

function toData(input: ProductInput) {
  return {
    type: input.type,
    reference: input.reference ?? null,
    name: input.name,
    description: input.description ?? null,
    unit: input.unit ?? null,
    unitPriceExclTax: input.unitPriceExclTax,
    vatRate: input.vatRate,
    isActive: input.isActive,
  };
}

export async function createProduct(access: CompanyAccess, userId: string, input: ProductInput, meta: Meta = {}): Promise<Product> {
  assertVatAllowed(access, input.vatRate);
  const product = await access.db.product.create({ data: { companyId: access.company.id, ...toData(input) } });
  await recordAudit({ action: "product.create", userId, companyId: access.company.id, entityType: "Product", entityId: product.id, ...meta });
  return product;
}

export async function updateProduct(access: CompanyAccess, userId: string, productId: string, input: ProductInput, meta: Meta = {}): Promise<Product> {
  await getProduct(access, productId);
  assertVatAllowed(access, input.vatRate);
  const product = await access.db.product.update({ where: { id: productId }, data: toData(input) });
  await recordAudit({ action: "product.update", userId, companyId: access.company.id, entityType: "Product", entityId: product.id, ...meta });
  return product;
}

export async function setProductActive(access: CompanyAccess, userId: string, productId: string, isActive: boolean, meta: Meta = {}): Promise<Product> {
  await getProduct(access, productId);
  const product = await access.db.product.update({ where: { id: productId }, data: { isActive } });
  await recordAudit({
    action: isActive ? "product.reactivate" : "product.archive",
    userId,
    companyId: access.company.id,
    entityType: "Product",
    entityId: product.id,
    ...meta,
  });
  return product;
}

export async function productsCsv(access: CompanyAccess): Promise<string> {
  const products = await access.db.product.findMany({ orderBy: { name: "asc" } });
  return toCsv(
    ["Référence", "Désignation", "Type", "Description", "Unité", "Prix unitaire HT", "Taux de TVA (%)", "Actif"],
    products.map((p) => [
      p.reference,
      p.name,
      p.type === "SERVICE" ? "Prestation" : "Bien",
      p.description,
      p.unit,
      p.unitPriceExclTax.toFixed(4).replace(/0{1,2}$/, "").replace(".", ","),
      p.vatRate.toFixed(2).replace(".", ","),
      p.isActive ? "Oui" : "Non",
    ]),
  );
}

// --- Taux de TVA ----------------------------------------------------------------

export type VatRateView = { id: string; label: string; rate: string; legalNote: string | null; isSystem: boolean; isDefault: boolean };

function serializeVatRate(rate: VatRate): VatRateView {
  return { id: rate.id, label: rate.label, rate: rate.rate.toFixed(2), legalNote: rate.legalNote, isSystem: rate.companyId === null, isDefault: rate.isDefault };
}

/** Taux proposés : référentiel commun + taux propres à l'entreprise. En franchise, seul le taux zéro est utilisable. */
export async function listVatRates(access: CompanyAccess): Promise<VatRateView[]> {
  const rates = await prisma.vatRate.findMany({
    where: { isActive: true, OR: [{ companyId: null }, { companyId: access.company.id }] },
    orderBy: [{ rate: "desc" }, { label: "asc" }],
  });
  const usable = access.company.vatRegime === "FRANCHISE" ? rates.filter((r) => r.rate.isZero()) : rates;
  return usable.map(serializeVatRate);
}

export async function createVatRate(access: CompanyAccess, userId: string, input: { label: string; rate: string; legalNote?: string }, meta: Meta = {}): Promise<VatRateView> {
  assertVatAllowed(access, input.rate);
  const duplicate = await prisma.vatRate.findFirst({
    where: { rate: input.rate, isActive: true, OR: [{ companyId: null }, { companyId: access.company.id }] },
  });
  if (duplicate) throw errors.conflict("VAT_RATE_EXISTS", `Le taux de ${duplicate.rate.toFixed(2).replace(".", ",")} % existe déjà (« ${duplicate.label} »).`);
  const rate = await prisma.vatRate.create({ data: { companyId: access.company.id, label: input.label, rate: input.rate, legalNote: input.legalNote ?? null } });
  await recordAudit({ action: "vat_rate.create", userId, companyId: access.company.id, entityType: "VatRate", entityId: rate.id, ...meta });
  return serializeVatRate(rate);
}

export async function deleteVatRate(access: CompanyAccess, userId: string, rateId: string, meta: Meta = {}): Promise<void> {
  // Seuls les taux propres à l'entreprise sont supprimables ; ceux du référentiel commun ne le sont pas.
  const result = await prisma.vatRate.deleteMany({ where: { id: rateId, companyId: access.company.id } });
  if (result.count === 0) throw errors.notFound("Taux de TVA introuvable.");
  await recordAudit({ action: "vat_rate.delete", userId, companyId: access.company.id, entityType: "VatRate", entityId: rateId, ...meta });
}
