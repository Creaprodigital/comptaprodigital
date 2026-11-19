import { z } from "zod";
import { authRoute, noContent } from "@/server/http/api";
import { clearSessionCookie } from "@/server/auth/session";
import { RATE_LIMITS, enforceRateLimit } from "@/server/security/rate-limit";
import { deleteAccount, deletionCheck } from "@/server/modules/account/deletion";

const deletionSchema = z.object({
  password: z.string().min(1, "Saisissez votre mot de passe").max(256),
  code: z.string().max(20).nullable().optional(),
  confirmation: z.string().max(20),
});

/** Conditions de suppression (entreprises à archiver, éventuels obstacles). */
export const GET = authRoute({}, async ({ auth }) => deletionCheck(auth.user.id));

/** Suppression définitive du compte (mot de passe, code de double authentification le cas échéant, confirmation). */
export const POST = authRoute<Record<string, never>, typeof deletionSchema>({ body: deletionSchema }, async ({ auth, body, meta }) => {
  await enforceRateLimit(RATE_LIMITS.passwordReset, `deletion:${auth.user.id}`);
  await deleteAccount(auth, body, meta);
  await clearSessionCookie();
  return noContent();
});
