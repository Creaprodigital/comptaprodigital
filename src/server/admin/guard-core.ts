import { AppError } from "@/server/http/errors";
import type { AuthContext } from "@/server/auth/session";

/** Contrôle d'accès à l'administration, utilisable hors composants serveur (routes API, tests). */
export function assertSuperAdmin(auth: AuthContext | null): AuthContext {
  if (!auth || !auth.user.isSuperAdmin) throw new AppError(404, "NOT_FOUND", "Ressource introuvable.");
  if (!auth.user.mfaEnabledAt) throw new AppError(403, "ADMIN_MFA_REQUIRED", "Activez la double authentification sur votre compte pour accéder à l'administration.");
  return auth;
}
