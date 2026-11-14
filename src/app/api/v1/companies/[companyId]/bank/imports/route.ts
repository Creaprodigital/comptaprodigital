import { authRoute, created } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeBank } from "@/server/modules/bank/access";
import { commitImport, listImports } from "@/server/modules/bank/imports";
import { readStatementUpload } from "@/server/modules/bank/upload";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:read");
  return listImports(access);
});

/** Import d'un relevé (multipart : `file`, `bankAccountId`, `mapping` en JSON pour un CSV). */
export const POST = authRoute<Params>({ rateLimit: RATE_LIMITS.uploads }, async ({ auth, params, request, meta }) => {
  const access = await authorizeBank(auth.user.id, params.companyId, "bank:write");
  return created(await commitImport(access, auth.user.id, await readStatementUpload(request), meta));
});
