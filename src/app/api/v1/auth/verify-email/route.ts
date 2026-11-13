import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { verifyEmail } from "@/server/auth/auth-service";
import { tokenSchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: tokenSchema, rateLimit: RATE_LIMITS.login }, async ({ body, meta }) => {
  await verifyEmail(body.token, meta);
  return { verified: true };
});
