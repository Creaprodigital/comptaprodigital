import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { requestPasswordReset } from "@/server/auth/auth-service";
import { emailOnlySchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: emailOnlySchema, rateLimit: RATE_LIMITS.passwordReset }, async ({ body, meta }) => {
  await requestPasswordReset(body.email, meta);
  return { message: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé." };
});
