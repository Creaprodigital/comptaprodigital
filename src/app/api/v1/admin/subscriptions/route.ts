import { adminRoute } from "@/server/http/api";
import { listSubscriptions } from "@/server/modules/admin/users";
import { pageQuery } from "@/lib/schemas/admin";

export const GET = adminRoute<Record<string, never>, undefined, typeof pageQuery>({ query: pageQuery }, async ({ query }) => listSubscriptions(query));
