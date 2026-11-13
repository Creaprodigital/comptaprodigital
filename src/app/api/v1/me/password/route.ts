import { authRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { changePassword } from "@/server/auth/auth-service";
import { changePasswordSchema } from "@/lib/schemas/auth";

export const POST = authRoute({ body: changePasswordSchema, rateLimit: RATE_LIMITS.passwordReset }, async ({ auth, body, meta }) => {
  await changePassword(auth, body, meta);
  return { changed: true };
});
