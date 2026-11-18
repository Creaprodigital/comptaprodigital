import { adminRoute } from "@/server/http/api";
import { listCompanies } from "@/server/modules/admin/companies";
import { pageQuery } from "@/lib/schemas/admin";

export const GET = adminRoute<Record<string, never>, undefined, typeof pageQuery>({ query: pageQuery }, async ({ query }) => listCompanies(query));
