import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { errors } from "@/server/http/errors";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeVat } from "@/server/modules/accounting/access";
import { vatPeriodCsv } from "@/server/modules/vat/service";
import { isIsoDate } from "@/lib/dates";

export const GET = authRoute<{ companyId: string; startDate: string }>({ rateLimit: RATE_LIMITS.exports }, async ({ auth, params }) => {
  if (!isIsoDate(params.startDate)) throw errors.notFound("Période de TVA introuvable.");
  const access = await authorizeVat(auth.user.id, params.companyId, "exports:run");
  const { fileName, content } = await vatPeriodCsv(access, params.startDate);
  return csvResponse(fileName, content);
});
