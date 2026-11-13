import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { login } from "@/server/auth/auth-service";
import { setSessionCookie } from "@/server/auth/session";
import { loginSchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: loginSchema, rateLimit: RATE_LIMITS.login }, async ({ body, meta }) => {
  const result = await login(body, meta);
  await setSessionCookie(result.token, result.expiresAt);
  return { status: result.status };
});
