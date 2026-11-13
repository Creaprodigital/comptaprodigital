import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { resetPassword } from "@/server/auth/auth-service";
import { clearSessionCookie } from "@/server/auth/session";
import { resetPasswordSchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: resetPasswordSchema, rateLimit: RATE_LIMITS.passwordReset }, async ({ body, meta }) => {
  await resetPassword(body.token, body.password, meta);
  await clearSessionCookie();
  return { reset: true };
});
