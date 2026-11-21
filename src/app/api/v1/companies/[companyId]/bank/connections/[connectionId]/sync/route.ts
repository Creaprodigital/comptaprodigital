import { authRoute } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { authorizeBank } from "@/server/modules/bank/access";
import { syncBankConnection } from "@/server/modules/bank/connections";

type Params = { companyId: string; connectionId: string };

export const POST = authRoute<Params>({ rateLimit: { name: "bank.sync", limit: 20, windowSeconds: 60 * 60 } }, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  const connection = await access.db.bankConnection.findFirst({ where: { id: params.connectionId, status: { not: "REVOKED" } }, select: { id: true } });
  if (!connection) throw errors.notFound("Connexion bancaire introuvable.");
  return syncBankConnection(connection.id, { access });
});
