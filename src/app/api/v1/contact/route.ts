import { publicRoute, created } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { submitContactMessage } from "@/server/modules/contact/service";
import { contactSchema } from "@/lib/schemas/contact";

export const POST = publicRoute({ body: contactSchema, rateLimit: RATE_LIMITS.contact }, async ({ body, auth }) =>
  created(await submitContactMessage(body, auth?.user.id)),
);
