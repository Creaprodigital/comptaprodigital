/** Noms des cookies — module sans dépendance, importable depuis le proxy. */
export const SESSION_COOKIE_DEV = "cpd_session";
/** Le préfixe __Host- impose Secure + Path=/ et interdit l'attribut Domain. */
export const SESSION_COOKIE_SECURE = "__Host-cpd_session";

export const PENDING_MFA_TTL_MINUTES = 10;
export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 60;
export const INVITATION_TTL_DAYS = 7;
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;
