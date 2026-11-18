import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { resolveSession } from "@/server/auth/session";

/**
 * Accès à l'administration de la plateforme : réservé aux super administrateurs
 * ayant activé la double authentification. Pour tout autre compte, l'espace
 * n'existe pas (404). Un super administrateur n'a aucun accès implicite aux
 * données des entreprises : seul un accès justifié, limité dans le temps,
 * notifié au titulaire et journalisé, ouvre une consultation (voir access-grants.ts).
 */

export { assertSuperAdmin } from "./guard-core";

/** Garde des pages /admin. */
export const requireSuperAdmin = cache(async () => {
  const auth = await resolveSession();
  if (!auth) redirect("/connexion?next=/admin");
  if (!auth.user.isSuperAdmin) notFound();
  if (!auth.user.mfaEnabledAt) redirect("/app/compte?mfa=admin");
  return auth;
});
