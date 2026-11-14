import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { sendQuoteByEmail } from "@/server/modules/invoicing/sending";
import { sendDocumentSchema } from "@/lib/schemas/invoicing";

export const POST = authRoute<{ companyId: string; quoteId: string }, typeof sendDocumentSchema>(
  { body: sendDocumentSchema, rateLimit: RATE_LIMITS.documentEmail },
  async ({ auth, params, body, meta }) => {
    const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:write");
    await sendQuoteByEmail(access, auth.user, params.quoteId, body, meta);
    return { sent: true };
  },
);
