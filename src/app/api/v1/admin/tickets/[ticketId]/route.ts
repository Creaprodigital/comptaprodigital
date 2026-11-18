import { z } from "zod";
import { adminRoute } from "@/server/http/api";
import { getTicket, replyAsStaff, updateTicket } from "@/server/modules/support/service";
import { adminTicketUpdateSchema } from "@/lib/schemas/admin";
import { ticketReplySchema } from "@/lib/schemas/support";

type Params = { ticketId: string };
const staffReplySchema = ticketReplySchema.extend({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).default("WAITING_CUSTOMER") });

export const GET = adminRoute<Params>({}, async ({ params }) => getTicket(params.ticketId));

export const POST = adminRoute<Params, typeof staffReplySchema>({ body: staffReplySchema }, async ({ auth, params, body, meta }) => replyAsStaff(auth.user.id, params.ticketId, body, meta));

export const PATCH = adminRoute<Params, typeof adminTicketUpdateSchema>({ body: adminTicketUpdateSchema }, async ({ auth, params, body, meta }) => updateTicket(auth.user.id, params.ticketId, body, meta));
