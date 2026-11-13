/** Erreur applicative portant un statut HTTP et un code stable exploitable par le client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  unauthenticated: () => new AppError(401, "UNAUTHENTICATED", "Authentification requise."),
  forbidden: (message = "Vous n'avez pas les droits nécessaires pour effectuer cette action.") =>
    new AppError(403, "FORBIDDEN", message),
  notFound: (message = "Ressource introuvable.") => new AppError(404, "NOT_FOUND", message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  badRequest: (code: string, message: string, details?: unknown) => new AppError(400, code, message, details),
  validation: (details: Array<{ path: string; message: string }>) =>
    new AppError(422, "VALIDATION_ERROR", "Certaines informations sont invalides.", details),
};
