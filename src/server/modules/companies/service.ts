import type { Company } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { getUserPlanLimits } from "@/server/modules/plans/service";
import { fiscalYearBounds } from "@/server/modules/companies/fiscal-year";
import { accountingModeFor } from "@/config/legal";
import { isUserReadOnly } from "@/server/billing/standing";
import { frenchVatNumberFromSiren } from "@/lib/identifiers";
import { fromIsoDate, todayInParis } from "@/lib/dates";
import type { CreateCompanyInput, UpdateCompanyInput } from "@/lib/schemas/company";

type Meta = { ip?: string | null; userAgent?: string | null };

export type CompanySummary = {
  id: string;
  name: string;
  tradeName: string | null;
  siren: string | null;
  legalForm: Company["legalForm"];
  status: Company["status"];
  roleKey: string;
  roleName: string;
};

/** Entreprises dont l'utilisateur est membre actif. */
export async function listUserCompanies(userId: string): Promise<CompanySummary[]> {
  const memberships = await prisma.companyUser.findMany({
    where: { userId, status: "ACTIVE", company: { status: { not: "ARCHIVED" } } },
    include: { company: true, role: { select: { key: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.company.id,
    name: m.company.name,
    tradeName: m.company.tradeName,
    siren: m.company.siren,
    legalForm: m.company.legalForm,
    status: m.company.status,
    roleKey: m.role.key,
    roleName: m.role.name,
  }));
}

async function countOwnedCompanies(userId: string): Promise<number> {
  return prisma.companyUser.count({
    where: { userId, status: "ACTIVE", role: { key: "OWNER" }, company: { status: { not: "ARCHIVED" } } },
  });
}

/**
 * Crée une entreprise, son propriétaire et son premier exercice comptable.
 * Le nombre d'entreprises est plafonné par la formule d'abonnement du compte.
 */
export async function createCompany(userId: string, input: CreateCompanyInput, meta: Meta = {}): Promise<Company> {
  const plan = await getUserPlanLimits(userId);
  if (!plan) {
    throw new AppError(402, "SUBSCRIPTION_REQUIRED", "Un abonnement est nécessaire pour créer une entreprise.");
  }
  if (await isUserReadOnly(userId)) {
    throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Votre abonnement n'est plus actif : réactivez-le depuis la page Abonnement pour créer une entreprise.");
  }
  const owned = await countOwnedCompanies(userId);
  if (plan.limits.maxCompanies !== null && owned >= plan.limits.maxCompanies) {
    throw new AppError(
      403,
      "PLAN_LIMIT_REACHED",
      `Votre formule ${plan.planName} est limitée à ${plan.limits.maxCompanies} entreprise${plan.limits.maxCompanies > 1 ? "s" : ""}. Passez à une formule supérieure pour en ajouter.`,
    );
  }

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  const fiscalYear = fiscalYearBounds(input.fiscalYearStartMonth, todayInParis());

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: input.name,
        tradeName: input.tradeName,
        siren: input.siren ?? input.siret?.slice(0, 9),
        siret: input.siret,
        vatNumber: input.vatNumber ?? (input.vatRegime !== "FRANCHISE" && input.siren ? frenchVatNumberFromSiren(input.siren) : undefined),
        nafCode: input.nafCode,
        legalForm: input.legalForm,
        taxRegime: input.taxRegime,
        vatRegime: input.vatRegime,
        vatExigibility: input.vatExigibility,
        accountingMode: accountingModeFor(input.taxRegime),
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        postalCode: input.postalCode,
        city: input.city,
        email: input.email,
        phone: input.phone,
        createdById: userId,
      },
    });
    await tx.companyUser.create({ data: { companyId: created.id, userId, roleId: ownerRole.id } });
    await tx.fiscalYear.create({
      data: {
        companyId: created.id,
        label: fiscalYear.label,
        startDate: fromIsoDate(fiscalYear.startDate),
        endDate: fromIsoDate(fiscalYear.endDate),
      },
    });
    return created;
  });

  await recordAudit({
    action: "company.create",
    userId,
    companyId: company.id,
    entityType: "Company",
    entityId: company.id,
    metadata: { legalForm: company.legalForm, taxRegime: company.taxRegime, vatRegime: company.vatRegime },
    ...meta,
  });
  return company;
}

export async function updateCompany(access: CompanyAccess, userId: string, input: UpdateCompanyInput, meta: Meta = {}): Promise<Company> {
  const before = access.company;
  const company = await prisma.company.update({
    where: { id: before.id },
    data: {
      name: input.name,
      tradeName: input.tradeName ?? null,
      siren: input.siren ?? null,
      siret: input.siret ?? null,
      vatNumber: input.vatNumber ?? null,
      nafCode: input.nafCode ?? null,
      legalForm: input.legalForm,
      taxRegime: input.taxRegime,
      vatRegime: input.vatRegime,
      vatExigibility: input.vatExigibility,
      accountingMode: accountingModeFor(input.taxRegime),
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
    },
  });

  // Traçabilité : seuls les champs réellement modifiés sont consignés.
  const tracked = ["name", "siren", "siret", "vatNumber", "legalForm", "taxRegime", "vatRegime", "vatExigibility"] as const;
  const changes = Object.fromEntries(
    tracked.filter((key) => before[key] !== company[key]).map((key) => [key, { from: before[key], to: company[key] }]),
  );
  await recordAudit({
    action: "company.update",
    userId,
    companyId: company.id,
    entityType: "Company",
    entityId: company.id,
    metadata: { changes },
    ...meta,
  });
  return company;
}

export function serializeCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    tradeName: company.tradeName,
    siren: company.siren,
    siret: company.siret,
    vatNumber: company.vatNumber,
    nafCode: company.nafCode,
    legalForm: company.legalForm,
    taxRegime: company.taxRegime,
    vatRegime: company.vatRegime,
    vatExigibility: company.vatExigibility,
    accountingMode: company.accountingMode,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    postalCode: company.postalCode,
    city: company.city,
    country: company.country,
    email: company.email,
    phone: company.phone,
    currency: company.currency,
    status: company.status,
    createdAt: company.createdAt.toISOString(),
  };
}

export type SerializedCompany = ReturnType<typeof serializeCompany>;

/** Vérifie qu'un utilisateur peut basculer sur une entreprise (membre actif, entreprise non archivée). */
export async function assertCanActivateCompany(userId: string, companyId: string): Promise<void> {
  const membership = await prisma.companyUser.findUnique({
    where: { companyId_userId: { companyId, userId } },
    include: { company: { select: { status: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.company.status === "ARCHIVED") {
    throw errors.notFound("Entreprise introuvable.");
  }
}
