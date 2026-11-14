import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * Isolation multi-entreprises (défense en profondeur).
 *
 * `tenantDb(companyId)` retourne un client Prisma dont toutes les requêtes sur
 * les modèles métier sont automatiquement restreintes à l'entreprise :
 *  - lectures, mises à jour et suppressions : `companyId` est ajouté au filtre ;
 *  - créations : `companyId` est imposé, toute autre valeur est rejetée.
 *
 * Les services métier n'utilisent jamais le client global pour ces modèles.
 * Convention : dans les créations, les clés étrangères sont passées sous forme
 * scalaire (`customerId: …`) et non via `connect`.
 */

export const TENANT_MODELS: ReadonlySet<string> = new Set<Prisma.ModelName>([
  "Customer",
  "Supplier",
  "Product",
  "Quote",
  "Invoice",
  "RecurringInvoice",
  "NumberSequence",
  "Payment",
  "Purchase",
  "BankAccount",
  "BankTransaction",
  "BankImport",
  "CategorizationRule",
  "FiscalYear",
  "AccountingAccount",
  "AccountingJournal",
  "AccountingEntry",
  "AccountingEntryLine",
  "FixedAsset",
  "VatPeriod",
  "Document",
  "DocumentLink",
  "AiSuggestion",
  "CompanyInvitation",
  "CompanyLogo",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

type AnyArgs = Record<string, unknown>;

/** Ajoute le filtre d'entreprise ; un filtre explicite sur une autre entreprise est une erreur de programmation. */
function scopeWhere(model: string, where: unknown, companyId: string): AnyArgs {
  const filter = (where as AnyArgs | undefined) ?? {};
  if (filter.companyId !== undefined && filter.companyId !== companyId) {
    throw new TenantIsolationError(`${model} : tentative de lecture ou d'écriture dans une autre entreprise.`);
  }
  return { ...filter, companyId };
}

function scopeData(model: string, data: unknown, companyId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => scopeData(model, row, companyId));
  const row = { ...(data as AnyArgs) };
  if ("company" in row) {
    throw new TenantIsolationError(`${model} : utilisez la clé scalaire companyId (imposée automatiquement), pas la relation company.`);
  }
  if (row.companyId !== undefined && row.companyId !== companyId) {
    throw new TenantIsolationError(`${model} : tentative d'écriture dans une autre entreprise.`);
  }
  row.companyId = companyId;
  return row;
}

function assertNoTenantReassignment(model: string, data: unknown, companyId: string) {
  const row = (data ?? {}) as AnyArgs;
  if ("company" in row || (row.companyId !== undefined && row.companyId !== companyId)) {
    throw new TenantIsolationError(`${model} : le rattachement à une entreprise ne peut pas être modifié.`);
  }
}

export function tenantDb(companyId: string) {
  if (!companyId) throw new TenantIsolationError("Identifiant d'entreprise manquant.");

  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const scoped = { ...(args as AnyArgs) };

          if (WHERE_OPERATIONS.has(operation)) {
            scoped.where = scopeWhere(model, scoped.where, companyId);
            if (operation === "update" || operation === "updateMany") {
              assertNoTenantReassignment(model, scoped.data, companyId);
            }
          } else if (operation === "create" || operation === "createMany") {
            scoped.data = scopeData(model, scoped.data, companyId);
          } else if (operation === "upsert") {
            scoped.where = scopeWhere(model, scoped.where, companyId);
            scoped.create = scopeData(model, scoped.create, companyId);
            assertNoTenantReassignment(model, scoped.update, companyId);
          } else {
            throw new TenantIsolationError(`${model}.${operation} n'est pas autorisé sur le client cloisonné.`);
          }

          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
