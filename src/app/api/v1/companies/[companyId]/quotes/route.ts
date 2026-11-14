import { authRoute, created } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { createQuote, listQuotes, serializeQuote } from "@/server/modules/invoicing/quotes";
import { listQuerySchema, quoteSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params, undefined, typeof listQuerySchema>({ query: listQuerySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:read");
  return listQuotes(access, { q: query.q, filter: query.status, page: query.page, pageSize: query.pageSize });
});

export const POST = authRoute<Params, typeof quoteSchema>({ body: quoteSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "quotes:write");
  return created(serializeQuote(await createQuote(access, auth.user.id, body, meta)));
});
