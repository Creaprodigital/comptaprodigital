import { authRoute } from "@/server/http/api";
import { authorizeBank } from "@/server/modules/bank/access";
import { deleteImport } from "@/server/modules/bank/imports";

export const DELETE = authRoute<{ companyId: string; importId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return deleteImport(access, auth.user.id, params.importId, meta);
});
