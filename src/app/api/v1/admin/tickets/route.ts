import { adminRoute } from "@/server/http/api";
import { listTickets } from "@/server/modules/support/service";
import { pageQuery } from "@/lib/schemas/admin";

export const GET = adminRoute<Record<string, never>, undefined, typeof pageQuery>({ query: pageQuery }, async ({ query }) =>
  listTickets({ status: (query.status as never) ?? "active", q: query.q, page: query.page }),
);
