import { authorizeCompany, type CompanyAccess } from "@/server/rbac/service";
import { requireModule } from "@/server/modules/plans/service";

/** Accès au module bancaire : droits de l'utilisateur sur l'entreprise, puis formule de l'entreprise. */
export async function authorizeBank(userId: string, companyId: string, permission: "bank:read" | "bank:write"): Promise<CompanyAccess> {
  const access = await authorizeCompany(userId, companyId, permission);
  await requireModule(companyId, "bank");
  return access;
}

/** Accès au module documentaire. */
export async function authorizeDocuments(userId: string, companyId: string, permission: "documents:read" | "documents:write" | "documents:delete"): Promise<CompanyAccess> {
  const access = await authorizeCompany(userId, companyId, permission);
  await requireModule(companyId, "documents");
  return access;
}
