/**
 * Référentiel des rôles et permissions (RBAC).
 *
 * La matrice ci-dessous est la configuration par défaut, synchronisée en base
 * (tables roles / permissions / role_permissions) par `prisma/seed.ts`.
 * À l'exécution, les droits sont lus en base (voir rbac/service.ts).
 */

export const PERMISSIONS = {
  "company:read": "Consulter la fiche de l'entreprise",
  "company:update": "Modifier les informations et paramètres de l'entreprise",
  "company:delete": "Archiver l'entreprise",
  "members:read": "Voir les membres de l'entreprise",
  "members:manage": "Inviter, modifier ou retirer des membres",
  "dashboard:read": "Consulter le tableau de bord",
  "customers:read": "Consulter les clients",
  "customers:write": "Créer et modifier les clients",
  "suppliers:read": "Consulter les fournisseurs",
  "suppliers:write": "Créer et modifier les fournisseurs",
  "products:read": "Consulter le catalogue",
  "products:write": "Créer et modifier le catalogue",
  "quotes:read": "Consulter les devis",
  "quotes:write": "Créer et modifier les devis",
  "invoices:read": "Consulter les factures",
  "invoices:write": "Créer et modifier les factures en brouillon",
  "invoices:issue": "Émettre des factures et des avoirs",
  "payments:write": "Enregistrer les règlements",
  "purchases:read": "Consulter les achats",
  "purchases:write": "Saisir les achats",
  "bank:read": "Consulter les comptes et opérations bancaires",
  "bank:write": "Importer, catégoriser et rapprocher les opérations",
  "accounting:read": "Consulter la comptabilité",
  "accounting:write": "Saisir et valider des écritures",
  "accounting:close": "Verrouiller des périodes et clôturer un exercice",
  "vat:read": "Consulter la TVA",
  "vat:write": "Préparer les déclarations de TVA",
  "vat:validate": "Valider une période de TVA",
  "documents:read": "Consulter les documents",
  "documents:write": "Importer et classer des documents",
  "documents:delete": "Supprimer des documents",
  "exports:run": "Exporter les données comptables (FEC, CSV)",
  "audit:read": "Consulter le journal d'audit de l'entreprise",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const COMPANY_ROLE_KEYS = ["OWNER", "COMPANY_ADMIN", "COLLABORATOR", "READ_ONLY", "EXTERNAL_ACCOUNTANT"] as const;
export type CompanyRoleKey = (typeof COMPANY_ROLE_KEYS)[number];
export const SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";

/** Rôles qu'un administrateur peut attribuer (la propriété ne se délègue pas par invitation). */
export const ASSIGNABLE_ROLE_KEYS = ["COMPANY_ADMIN", "COLLABORATOR", "READ_ONLY", "EXTERNAL_ACCOUNTANT"] as const;
export type AssignableRoleKey = (typeof ASSIGNABLE_ROLE_KEYS)[number];

const READ_PERMISSIONS = ALL_PERMISSIONS.filter((key) => key.endsWith(":read"));

export const ROLE_DEFINITIONS: Record<
  CompanyRoleKey,
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  OWNER: {
    name: "Propriétaire",
    description: "Titulaire du compte : accès complet, y compris l'archivage de l'entreprise.",
    permissions: ALL_PERMISSIONS,
  },
  COMPANY_ADMIN: {
    name: "Administrateur",
    description: "Accès complet à l'entreprise, hors archivage.",
    permissions: ALL_PERMISSIONS.filter((key) => key !== "company:delete"),
  },
  COLLABORATOR: {
    name: "Collaborateur",
    description: "Gestion courante : facturation, achats, banque et documents.",
    permissions: [
      ...READ_PERMISSIONS.filter((key) => key !== "audit:read"),
      "customers:write",
      "suppliers:write",
      "products:write",
      "quotes:write",
      "invoices:write",
      "invoices:issue",
      "payments:write",
      "purchases:write",
      "bank:write",
      "documents:write",
    ],
  },
  READ_ONLY: {
    name: "Lecture seule",
    description: "Consultation de l'ensemble des données, sans modification.",
    permissions: READ_PERMISSIONS.filter((key) => key !== "audit:read"),
  },
  EXTERNAL_ACCOUNTANT: {
    name: "Expert-comptable externe",
    description: "Consultation complète, saisie comptable, TVA, clôture et exports.",
    permissions: [
      ...READ_PERMISSIONS,
      "purchases:write",
      "bank:write",
      "accounting:write",
      "accounting:close",
      "vat:write",
      "vat:validate",
      "documents:write",
      "exports:run",
    ],
  },
};

export const ROLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ROLE_DEFINITIONS).map(([key, def]) => [key, def.name])),
  [SUPER_ADMIN_ROLE_KEY]: "Super administrateur",
};
