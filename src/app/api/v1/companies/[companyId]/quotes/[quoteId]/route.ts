import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { deleteQuote, getQuoteDetail, getQuoteHistory, serializeQuote, updateQuote } from "@/server/modules/invoicing/quotes";
import { quoteSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string; quoteId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:read");
  const [quote, history] = await Promise.all([getQuoteDetail(access, params.quoteId), getQuoteHistory(access, params.quoteId)]);
  return { quote: serializeQuote(quote), history };
});

export const PATCH = authRoute<Params, typeof quoteSchema>({ body: quoteSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:write");
  return serializeQuote(await updateQuote(access, auth.user.id, params.quoteId, body, meta));
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:write");
  await deleteQuote(access, auth.user.id, params.quoteId, meta);
  return noContent();
});
