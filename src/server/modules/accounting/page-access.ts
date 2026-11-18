import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";

/**
 * Accès aux pages de la comptabilité : « ok » pour une comptabilité en partie
 * double incluse dans la formule, « cash-book » pour une micro-entreprise (livre
 * des recettes), « locked » si la formule n'inclut pas la comptabilité.
 */
export async function accountingPageAccess() {
  const context = await requireCompany("accounting:read");
  const { access } = context;
  if (access.company.accountingMode === "CASH_BOOK") return { ...context, state: "cash-book" as const };
  const enabled = await companyHasModule(access.company.id, "accounting");
  return { ...context, state: enabled ? ("ok" as const) : ("locked" as const) };
}
