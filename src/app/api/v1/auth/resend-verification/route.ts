import { publicRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { resendVerificationEmail } from "@/server/auth/auth-service";
import { emailOnlySchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: emailOnlySchema, rateLimit: RATE_LIMITS.emailToken }, async ({ body }) => {
  await resendVerificationEmail(body.email);
  return { message: "Si un compte en attente de confirmation existe pour cette adresse, un nouveau lien vient d'être envoyé." };
});
