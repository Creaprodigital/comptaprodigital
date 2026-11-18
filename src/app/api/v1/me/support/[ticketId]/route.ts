import { authRoute } from "@/server/http/api";
import { getUserTicket, replyAsUser } from "@/server/modules/support/service";
import { ticketReplySchema } from "@/lib/schemas/support";

type Params = { ticketId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => getUserTicket(auth.user.id, params.ticketId));

export const POST = authRoute<Params, typeof ticketReplySchema>({ body: ticketReplySchema }, async ({ auth, params, body }) => replyAsUser(auth.user.id, params.ticketId, body.body));
