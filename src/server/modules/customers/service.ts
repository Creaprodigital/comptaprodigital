import type { Customer, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { csvAmount, toCsv } from "@/server/http/csv";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { dec, toMoneyString } from "@/lib/money";
import type { CustomerInput } from "@/lib/schemas/invoicing";

type Meta = { ip?: string | null; userAgent?: string | null };

export type CustomerView = ReturnType<typeof serializeCustomer>;

export function serializeCustomer(customer: Customer) {
  return {
    id: customer.id,
    type: customer.type,
    name: customer.name,
    contactName: customer.contactName,
    email: customer.email,
    phone: customer.phone,
    siren: customer.siren,
    siret: customer.siret,
    vatNumber: customer.vatNumber,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country,
    paymentTermDays: customer.paymentTermDays,
    notes: customer.notes,
    archived: customer.archivedAt !== null,
    createdAt: customer.createdAt.toISOString(),
  };
}

function searchFilter(q: string | undefined): Prisma.CustomerWhereInput {
  if (!q) return {};
  return { OR: [{ name: { contains: q } }, { email: { contains: q } }, { contactName: { contains: q } }, { siren: { contains: q.replace(/\s/g, "") } }, { city: { contains: q } }] };
}

export async function listCustomers(
  access: CompanyAccess,
  options: { q?: string; page?: number; pageSize?: number; archived?: boolean } = {},
) {
  const { q, page = 1, pageSize = 25, archived = false } = options;
  const where: Prisma.CustomerWhereInput = { ...searchFilter(q), archivedAt: archived ? { not: null } : null };
  const [items, total] = await Promise.all([
    access.db.customer.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    access.db.customer.count({ where }),
  ]);

  // Encours par client : reste à encaisser sur les factures émises.
  const ids = items.map((c) => c.id);
  const outstanding = ids.length
    ? await prisma.invoice.groupBy({
        by: ["customerId"],
        where: { companyId: access.company.id, customerId: { in: ids }, type: { in: ["INVOICE", "DEPOSIT"] }, status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID"] } },
        _sum: { totalInclTax: true, amountPaid: true, creditedAmount: true },
      })
    : [];
  const byCustomer = new Map(
    outstanding.map((row) => [row.customerId, dec(row._sum.totalInclTax).minus(dec(row._sum.amountPaid)).minus(dec(row._sum.creditedAmount))]),
  );
  return {
    items: items.map((c) => ({ ...serializeCustomer(c), outstanding: toMoneyString(byCustomer.get(c.id)) })),
    total,
    page,
    pageSize,
  };
}

export async function getCustomer(access: CompanyAccess, customerId: string): Promise<Customer> {
  const customer = await access.db.customer.findFirst({ where: { id: customerId } });
  if (!customer) throw errors.notFound("Client introuvable.");
  return customer;
}

function toData(input: CustomerInput) {
  return {
    type: input.type,
    name: input.name,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    siren: input.siren ?? input.siret?.slice(0, 9) ?? null,
    siret: input.siret ?? null,
    vatNumber: input.vatNumber ?? null,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    country: input.country,
    paymentTermDays: input.paymentTermDays ?? null,
    notes: input.notes ?? null,
  };
}

export async function createCustomer(access: CompanyAccess, userId: string, input: CustomerInput, meta: Meta = {}): Promise<Customer> {
  const customer = await access.db.customer.create({ data: { companyId: access.company.id, ...toData(input) } });
  await recordAudit({ action: "customer.create", userId, companyId: access.company.id, entityType: "Customer", entityId: customer.id, ...meta });
  return customer;
}

export async function updateCustomer(access: CompanyAccess, userId: string, customerId: string, input: CustomerInput, meta: Meta = {}): Promise<Customer> {
  await getCustomer(access, customerId);
  const customer = await access.db.customer.update({ where: { id: customerId }, data: toData(input) });
  await recordAudit({ action: "customer.update", userId, companyId: access.company.id, entityType: "Customer", entityId: customer.id, ...meta });
  return customer;
}

/** Un client ayant des documents ne se supprime pas : il s'archive (et peut être réactivé). */
export async function setCustomerArchived(access: CompanyAccess, userId: string, customerId: string, archived: boolean, meta: Meta = {}): Promise<Customer> {
  await getCustomer(access, customerId);
  const customer = await access.db.customer.update({ where: { id: customerId }, data: { archivedAt: archived ? new Date() : null } });
  await recordAudit({
    action: archived ? "customer.archive" : "customer.unarchive",
    userId,
    companyId: access.company.id,
    entityType: "Customer",
    entityId: customer.id,
    ...meta,
  });
  return customer;
}

export async function customersCsv(access: CompanyAccess): Promise<string> {
  const customers = await access.db.customer.findMany({ orderBy: { name: "asc" } });
  return toCsv(
    ["Nom", "Type", "Contact", "E-mail", "Téléphone", "SIREN", "SIRET", "N° TVA", "Adresse", "Complément", "Code postal", "Ville", "Pays", "Délai de paiement (jours)", "Archivé"],
    customers.map((c) => [
      c.name,
      c.type === "COMPANY" ? "Professionnel" : "Particulier",
      c.contactName,
      c.email,
      c.phone,
      c.siren,
      c.siret,
      c.vatNumber,
      c.addressLine1,
      c.addressLine2,
      c.postalCode,
      c.city,
      c.country,
      c.paymentTermDays,
      c.archivedAt ? "Oui" : "Non",
    ]),
  );
}

export { csvAmount };
