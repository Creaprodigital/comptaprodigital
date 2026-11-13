import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { resolveSession } from "@/server/auth/session";
import { setActiveCompany } from "@/server/auth/session-store";
import { getCompanyAccess, type CompanyAccess } from "@/server/rbac/service";
import { listUserCompanies, type CompanySummary } from "@/server/modules/companies/service";
import type { PermissionKey } from "@/server/rbac/permissions";

/**
 * Garde-fous des pages de l'espace client (composants serveur).
 * Chaque page revérifie la session et les droits : le proxy n'est qu'un premier filtre.
 */

export const requireAuth = cache(async () => {
  const auth = await resolveSession();
  if (!auth) redirect("/connexion");
  return auth;
});

export type AppContext = {
  auth: Awaited<ReturnType<typeof requireAuth>>;
  companies: CompanySummary[];
  /** Accès à l'entreprise active, ou null si l'utilisateur n'a encore aucune entreprise. */
  access: CompanyAccess | null;
};

export const getAppContext = cache(async (): Promise<AppContext> => {
  const auth = await requireAuth();
  const companies = await listUserCompanies(auth.user.id);
  const activeId = companies.find((c) => c.id === auth.session.activeCompanyId)?.id ?? companies[0]?.id ?? null;

  // L'entreprise mémorisée n'est plus accessible (retrait, archivage) : on réaligne la session.
  if (activeId !== auth.session.activeCompanyId) {
    await setActiveCompany(auth.session.id, activeId).catch(() => undefined);
  }
  const access = activeId ? await getCompanyAccess(auth.user.id, activeId) : null;
  return { auth, companies, access };
});

/** Exige une entreprise active et, le cas échéant, une permission. */
export async function requireCompany(permission?: PermissionKey): Promise<AppContext & { access: CompanyAccess }> {
  const context = await getAppContext();
  if (!context.access) redirect("/app/entreprises");
  if (permission && !context.access.permissions.has(permission)) redirect("/app/acces-refuse");
  return context as AppContext & { access: CompanyAccess };
}
