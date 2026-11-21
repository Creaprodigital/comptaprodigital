import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { listBankConnections, startBankConnection } from "@/server/modules/bank/connections";

type Params = { companyId: string };
const startSchema = z.object({ connectionId: z.string().min(1).max(40).optional() });

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listBankConnections(access);
});

/** Démarre le parcours Bridge Connect ; le navigateur est ensuite redirigé vers l'URL retournée. */
export const POST = authRoute<Params, typeof startSchema>(
  { body: startSchema, rateLimit: { name: "bank.connect", limit: 10, windowSeconds: 60 * 60 } },
  async ({ auth, params, body, meta }) => {
    const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
    return startBankConnection(access, { id: auth.user.id, email: auth.user.email }, body, meta);
  },
);
