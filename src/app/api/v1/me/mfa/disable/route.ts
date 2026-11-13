import { authRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { disableMfa } from "@/server/auth/auth-service";
import { disableMfaSchema } from "@/lib/schemas/auth";

export const POST = authRoute({ body: disableMfaSchema, rateLimit: RATE_LIMITS.passwordReset }, async ({ auth, body, meta }) => {
  await disableMfa(auth, body.password, meta);
  return { disabled: true };
});
