import { AppError } from "@/server/http/errors";
import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { requireModule } from "@/server/modules/plans/service";
import type { PermissionKey } from "@/server/rbac/permissions";

/**
 * Accès à la comptabilité en partie double : droits de l'utilisateur, formule
 * incluant le module « accounting », entreprise tenant une comptabilité
 * d'engagement (les micro-entreprises tiennent un livre des recettes).
 */
export async function authorizeAccounting(userId: string, companyId: string, permission: PermissionKey): Promise<CompanyAccess> {
  const access = await authorizeCompany(userId, companyId, permission);
  if (access.company.accountingMode !== "DOUBLE_ENTRY") {
    throw new AppError(400, "CASH_BOOK_MODE", "Votre entreprise tient un livre des recettes (micro-entreprise) : la comptabilité en partie double ne la concerne pas.");
  }
  await requireModule(companyId, "accounting");
  return access;
}

/** Accès à la TVA : droits de l'utilisateur et formule incluant le module « vat ». */
export async function authorizeVat(userId: string, companyId: string, permission: PermissionKey): Promise<CompanyAccess> {
  const access = await authorizeCompany(userId, companyId, permission);
  await requireModule(companyId, "vat");
  return access;
}
