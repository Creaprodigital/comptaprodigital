import { publicRoute } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { completeMfaLogin } from "@/server/auth/auth-service";
import { resolvePendingMfaSession, setSessionCookie } from "@/server/auth/session";
import { mfaLoginSchema } from "@/lib/schemas/auth";

/** Étape 2 de la connexion : validation du code TOTP (ou d'un code de secours). */
export const POST = publicRoute({ body: mfaLoginSchema, rateLimit: RATE_LIMITS.mfaVerify }, async ({ body, meta }) => {
  const pending = await resolvePendingMfaSession();
  if (!pending) throw errors.unauthenticated();
  const result = await completeMfaLogin(pending, body.code, meta);
  await setSessionCookie(result.token, result.expiresAt);
  return { status: result.status };
});
