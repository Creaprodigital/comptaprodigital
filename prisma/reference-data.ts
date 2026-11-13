import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFINITIONS, SUPER_ADMIN_ROLE_KEY, type PermissionKey } from "../src/server/rbac/permissions";

/**
 * Données de référence indispensables au fonctionnement de la plateforme :
 * rôles, permissions, formules d'abonnement, taux de TVA et catégories système.
 * Idempotent : peut être rejoué à chaque déploiement sans écraser les tarifs
 * modifiés depuis l'administration.
 */

const PLANS = [
  {
    key: "STARTER",
    name: "Starter",
    tagline: "L'essentiel pour facturer et suivre son activité",
    monthlyPrice: "9.00",
    yearlyPrice: "90.00",
    trialDays: 14,
    isFeatured: false,
    sortOrder: 1,
    features: [
      "Devis et factures",
      "Tableau de bord",
      "Gestion des clients",
      "1 entreprise, 1 utilisateur",
      "Support par e-mail",
    ],
    limits: { maxCompanies: 1, maxMembers: 1, modules: ["dashboard", "invoicing", "customers"] },
  },
  {
    key: "PRO",
    name: "Pro",
    tagline: "La gestion complète d'une entreprise",
    monthlyPrice: "29.00",
    yearlyPrice: "290.00",
    trialDays: 14,
    isFeatured: true,
    sortOrder: 2,
    features: [
      "Facturation complète : acomptes, avoirs, récurrence",
      "Comptabilité et journaux",
      "Suivi et préparation de la TVA",
      "Import de relevés bancaires",
      "Gestion documentaire",
      "Accès pour votre expert-comptable",
    ],
    limits: {
      maxCompanies: 1,
      maxMembers: 2,
      modules: ["dashboard", "invoicing", "customers", "accounting", "vat", "bank", "documents"],
    },
  },
  {
    key: "BUSINESS",
    name: "Business",
    tagline: "Pour les structures à plusieurs entités et équipes",
    monthlyPrice: "59.00",
    yearlyPrice: "590.00",
    trialDays: 14,
    isFeatured: false,
    sortOrder: 3,
    features: [
      "Toutes les fonctionnalités Pro",
      "Multi-entreprises (jusqu'à 10)",
      "Collaborateurs illimités et rôles",
      "Automatisations avancées",
      "Exports comptables (FEC)",
      "Support prioritaire",
    ],
    limits: {
      maxCompanies: 10,
      maxMembers: null,
      modules: ["dashboard", "invoicing", "customers", "accounting", "vat", "bank", "documents", "automation", "exports", "priority-support"],
    },
  },
] as const;

const VAT_RATES = [
  { label: "Taux normal — 20 %", rate: "20.00", isDefault: true, legalNote: null },
  { label: "Taux intermédiaire — 10 %", rate: "10.00", isDefault: false, legalNote: null },
  { label: "Taux réduit — 5,5 %", rate: "5.50", isDefault: false, legalNote: null },
  { label: "Taux particulier — 2,1 %", rate: "2.10", isDefault: false, legalNote: null },
  { label: "Franchise en base — 0 %", rate: "0.00", isDefault: false, legalNote: "TVA non applicable, art. 293 B du CGI" },
] as const;

const CATEGORIES = [
  { name: "Achats de marchandises", kind: "EXPENSE", accountNumber: "607000" },
  { name: "Sous-traitance", kind: "EXPENSE", accountNumber: "611000" },
  { name: "Loyer et charges locatives", kind: "EXPENSE", accountNumber: "613200" },
  { name: "Logiciels et abonnements", kind: "EXPENSE", accountNumber: "615600" },
  { name: "Assurances", kind: "EXPENSE", accountNumber: "616000" },
  { name: "Honoraires", kind: "EXPENSE", accountNumber: "622600" },
  { name: "Publicité et marketing", kind: "EXPENSE", accountNumber: "623000" },
  { name: "Déplacements et missions", kind: "EXPENSE", accountNumber: "625100" },
  { name: "Repas et réceptions", kind: "EXPENSE", accountNumber: "625700" },
  { name: "Télécom et internet", kind: "EXPENSE", accountNumber: "626000" },
  { name: "Frais bancaires", kind: "EXPENSE", accountNumber: "627000" },
  { name: "Fournitures et petit équipement", kind: "EXPENSE", accountNumber: "606300" },
  { name: "Énergie", kind: "EXPENSE", accountNumber: "606100" },
  { name: "Salaires", kind: "PAYROLL", accountNumber: "641000" },
  { name: "Cotisations sociales", kind: "PAYROLL", accountNumber: "645000" },
  { name: "TVA reversée", kind: "TAX", accountNumber: "445510" },
  { name: "Impôts et taxes", kind: "TAX", accountNumber: "635000" },
  { name: "Virement interne", kind: "TRANSFER", accountNumber: "580000" },
  { name: "Apport ou compte courant d'associé", kind: "TRANSFER", accountNumber: "455000" },
  { name: "Ventes et prestations", kind: "INCOME", accountNumber: "706000" },
  { name: "Autres produits", kind: "INCOME", accountNumber: "758000" },
] as const;

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  // Permissions
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description, module: key.split(":")[0] },
      create: { key, description, module: key.split(":")[0] },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

  // Rôles d'entreprise et matrice de droits
  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: definition.name, description: definition.description },
      create: { key, name: definition.name, description: definition.description, scope: "COMPANY" },
    });
    const wanted = new Set(definition.permissions.map((p: PermissionKey) => permissionId.get(p)!));
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: [...wanted] } } });
    await prisma.rolePermission.createMany({
      data: [...wanted].map((id) => ({ roleId: role.id, permissionId: id })),
      skipDuplicates: true,
    });
  }
  await prisma.role.upsert({
    where: { key: SUPER_ADMIN_ROLE_KEY },
    update: {},
    create: {
      key: SUPER_ADMIN_ROLE_KEY,
      name: "Super administrateur",
      description: "Administration de la plateforme SaaS (sans accès implicite aux données financières des clients).",
      scope: "PLATFORM",
    },
  });

  // Formules : créées si absentes ; les tarifs existants ne sont jamais écrasés.
  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      update: {},
      create: { ...plan, features: [...plan.features], limits: { ...plan.limits, modules: [...plan.limits.modules] } },
    });
  }

  // Taux de TVA et catégories système (companyId NULL)
  if ((await prisma.vatRate.count({ where: { companyId: null } })) === 0) {
    await prisma.vatRate.createMany({ data: VAT_RATES.map((rate) => ({ ...rate, companyId: null })) });
  }
  const existingCategories = new Set(
    (await prisma.transactionCategory.findMany({ where: { companyId: null }, select: { name: true } })).map((c) => c.name),
  );
  const missing = CATEGORIES.filter((c) => !existingCategories.has(c.name));
  if (missing.length > 0) {
    await prisma.transactionCategory.createMany({ data: missing.map((c) => ({ ...c, companyId: null })) });
  }

  await prisma.applicationSetting.upsert({
    where: { key: "platform.registration_open" },
    update: {},
    create: { key: "platform.registration_open", value: true, description: "Autorise la création de nouveaux comptes." },
  });
}
