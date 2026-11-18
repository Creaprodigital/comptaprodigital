import { authRoute } from "@/server/http/api";
import { recordAudit } from "@/server/audit/audit";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { resyncAll } from "@/server/modules/accounting/sync";

/** Recalcule les écritures automatiques à partir des pièces (les écritures validées ne sont jamais modifiées). */
export const POST = authRoute<{ companyId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  const result = await resyncAll(access.company);
  await recordAudit({ action: "accounting.resync", userId: auth.user.id, companyId: access.company.id, metadata: result, ...meta });
  return result;
});
