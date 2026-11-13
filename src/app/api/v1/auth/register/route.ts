import { publicRoute, created } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { registerUser } from "@/server/auth/auth-service";
import { registerSchema } from "@/lib/schemas/auth";

export const POST = publicRoute({ body: registerSchema, rateLimit: RATE_LIMITS.register }, async ({ body, meta }) => {
  await registerUser(body, meta);
  // Réponse identique que l'adresse soit nouvelle ou déjà enregistrée.
  return created({ message: "Si cette adresse peut être utilisée, un e-mail de confirmation vient d'être envoyé." });
});
