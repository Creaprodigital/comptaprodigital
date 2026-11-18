import { randomUUID } from "node:crypto";
import type { Company, Customer, Prisma, SequenceType } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { CompanyAccess } from "@/server/rbac/service";
import { LEGAL_FORM_LABELS } from "@/config/legal";
import { InvoicingError, computeDocumentTotals, type DiscountType, type DocumentTotals } from "@/lib/invoicing";
import type { DocumentLineInput } from "@/lib/schemas/invoicing";

export type Meta = { ip?: string | null; userAgent?: string | null };

export type PreparedLines = {
  rows: Array<{
    productId: string | null;
    position: number;
    description: string;
    quantity: string;
    unit: string | null;
    unitPriceExclTax: string;
    discountRate: string;
    vatRate: string;
    totalExclTax: string;
    totalVat: string;
    totalInclTax: string;
  }>;
  totals: DocumentTotals;
};

/**
 * Contrôle les lignes d'un document et calcule ses totaux côté serveur :
 *  - les articles référencés doivent appartenir à l'entreprise ;
 *  - en franchise en base, aucune ligne ne peut porter de TVA ;
 *  - les totaux reçus du client ne sont jamais utilisés.
 */
export async function prepareDocumentLines(
  access: CompanyAccess,
  items: DocumentLineInput[],
  discount: { type: DiscountType; value: string },
): Promise<PreparedLines> {
  const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (productIds.length > 0) {
    const found = await access.db.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) {
      throw errors.validation([{ path: "items", message: "Un article du catalogue est introuvable." }]);
    }
  }
  if (access.company.vatRegime === "FRANCHISE" && items.some((item) => !new Decimal(item.vatRate).isZero())) {
    throw errors.validation([{ path: "items", message: "En franchise en base de TVA, toutes les lignes doivent être à 0 % de TVA." }]);
  }

  let totals: DocumentTotals;
  try {
    totals = computeDocumentTotals(items, discount);
  } catch (error) {
    if (error instanceof InvoicingError) throw errors.validation([{ path: "discountValue", message: error.message }]);
    throw error;
  }

  return {
    totals,
    rows: items.map((item, index) => ({
      productId: item.productId ?? null,
      position: index + 1,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitPriceExclTax: item.unitPriceExclTax,
      discountRate: item.discountRate,
      vatRate: item.vatRate,
      totalExclTax: totals.lines[index].totalExclTax.toFixed(2),
      totalVat: totals.lines[index].totalVat.toFixed(2),
      totalInclTax: totals.lines[index].totalInclTax.toFixed(2),
    })),
  };
}

export function totalsData(totals: DocumentTotals) {
  return {
    totalExclTax: totals.totalExclTax.toFixed(2),
    totalVat: totals.totalVat.toFixed(2),
    totalInclTax: totals.totalInclTax.toFixed(2),
  };
}

/** Le client doit appartenir à l'entreprise et ne pas être archivé. */
export async function resolveActiveCustomer(access: CompanyAccess, customerId: string): Promise<Customer> {
  const customer = await access.db.customer.findFirst({ where: { id: customerId } });
  if (!customer) throw errors.validation([{ path: "customerId", message: "Client introuvable." }]);
  if (customer.archivedAt) throw errors.validation([{ path: "customerId", message: "Ce client est archivé." }]);
  return customer;
}

/**
 * Prend le numéro suivant d'une séquence. À appeler dans une transaction : le
 * compteur est verrouillé jusqu'à la validation, et un abandon de la transaction
 * rend le numéro — la suite reste continue, sans trou ni doublon.
 */
export async function takeNextNumber(tx: Prisma.TransactionClient, companyId: string, type: SequenceType, year: number): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO number_sequences (id, companyId, type, year, lastNumber)
    VALUES (${randomUUID()}, ${companyId}, ${type}, ${year}, 1)
    ON DUPLICATE KEY UPDATE lastNumber = lastNumber + 1`;
  const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    SELECT lastNumber FROM number_sequences WHERE companyId = ${companyId} AND type = ${type} AND year = ${year}`;
  return Number(rows[0].lastNumber);
}

/** Rejoue une transaction interrompue par un interblocage ou un conflit d'écriture. */
export async function withTransactionRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : "";
      const retryable = code === "P2034" || /deadlock|1213|write conflict/i.test(message);
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

// --- Instantané des parties ---------------------------------------------------

export type PartySnapshot = {
  name: string;
  contactName?: string | null;
  legalForm?: string | null;
  shareCapital?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  siren?: string | null;
  siret?: string | null;
  rcsCity?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type PartiesSnapshot = {
  seller: PartySnapshot & { ibanEncrypted?: string | null; bic?: string | null; vatRegime: string };
  buyer: PartySnapshot & { type: string };
  terms: { latePenaltyRate: string | null; earlyPaymentDiscountNote: string | null; footer: string | null };
};

/** Fige l'identité de l'émetteur et du client telle qu'elle est au moment de l'émission. */
export function buildPartiesSnapshot(company: Company, customer: Customer): PartiesSnapshot {
  return {
    seller: {
      name: company.name,
      legalForm: company.legalForm === "OTHER" ? null : LEGAL_FORM_LABELS[company.legalForm],
      shareCapital: company.shareCapital?.toFixed(2) ?? null,
      addressLine1: company.addressLine1,
      addressLine2: company.addressLine2,
      postalCode: company.postalCode,
      city: company.city,
      country: company.country,
      siren: company.siren,
      siret: company.siret,
      rcsCity: company.rcsCity,
      vatNumber: company.vatNumber,
      email: company.email,
      phone: company.phone,
      ibanEncrypted: company.ibanEncrypted,
      bic: company.bic,
      vatRegime: company.vatRegime,
    },
    buyer: {
      type: customer.type,
      name: customer.name,
      contactName: customer.contactName,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.country,
      siren: customer.siren,
      siret: customer.siret,
      vatNumber: customer.vatNumber,
      email: customer.email,
    },
    terms: {
      latePenaltyRate: company.latePenaltyRate?.toFixed(2) ?? null,
      earlyPaymentDiscountNote: company.earlyPaymentDiscountNote,
      footer: company.invoiceFooter,
    },
  };
}

export type ItemView = {
  id: string;
  productId: string | null;
  position: number;
  description: string;
  quantity: string;
  unit: string | null;
  unitPriceExclTax: string;
  discountRate: string;
  vatRate: string;
  totalExclTax: string;
};

type ItemRow = {
  id: string;
  productId: string | null;
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unit: string | null;
  unitPriceExclTax: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  totalExclTax: Prisma.Decimal;
};

export function serializeItem(item: ItemRow): ItemView {
  return {
    id: item.id,
    productId: item.productId,
    position: item.position,
    description: item.description,
    quantity: new Decimal(item.quantity.toString()).toString(),
    unit: item.unit,
    unitPriceExclTax: new Decimal(item.unitPriceExclTax.toString()).toString(),
    discountRate: new Decimal(item.discountRate.toString()).toString(),
    vatRate: new Decimal(item.vatRate.toString()).toString(),
    totalExclTax: item.totalExclTax.toFixed(2),
  };
}

export type HistoryEntry = { id: string; action: string; at: string; actor: string | null; detail: string | null };

/** Historique d'un document, tiré du journal d'audit de l'entreprise. */
export async function documentHistory(companyId: string, entityType: "Invoice" | "Quote" | "BankTransaction" | "Document" | "Purchase" | "FixedAsset" | "VatPeriod" | "AccountingEntry", entityId: string): Promise<HistoryEntry[]> {
  const logs = await prisma.auditLog.findMany({
    where: { companyId, entityType, entityId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { firstName: true, lastName: true } } },
    take: 200,
  });
  return logs.map((log) => {
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    const detail = typeof metadata.detail === "string" ? metadata.detail : null;
    return {
      id: log.id,
      action: log.action,
      at: log.createdAt.toISOString(),
      actor: log.user ? `${log.user.firstName} ${log.user.lastName}` : log.actorType === "SYSTEM" ? "Automatisation" : null,
      detail,
    };
  });
}
