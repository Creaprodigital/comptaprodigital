import { authRoute, created } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { createTicket, listUserTickets } from "@/server/modules/support/service";
import { ticketSchema } from "@/lib/schemas/support";

export const GET = authRoute({}, async ({ auth }) => listUserTickets(auth.user.id));

export const POST = authRoute<Record<string, never>, typeof ticketSchema>({ body: ticketSchema, rateLimit: RATE_LIMITS.contact }, async ({ auth, body, meta }) => created(await createTicket(auth.user.id, body, meta)));
