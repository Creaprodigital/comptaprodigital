import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { serializeQuote, setQuoteStatus } from "@/server/modules/invoicing/quotes";
import { quoteStatusSchema } from "@/lib/schemas/invoicing";

export const POST = authRoute<{ companyId: string; quoteId: string }, typeof quoteStatusSchema>({ body: quoteStatusSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:write");
  return serializeQuote(await setQuoteStatus(access, auth.user.id, params.quoteId, body.status, meta));
});
