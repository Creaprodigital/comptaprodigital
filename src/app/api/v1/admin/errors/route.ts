import { adminRoute } from "@/server/http/api";
import { listErrors, purgeErrors } from "@/server/modules/admin/errors";
import { pageQuery } from "@/lib/schemas/admin";

export const GET = adminRoute<Record<string, never>, undefined, typeof pageQuery>({ query: pageQuery }, async ({ query }) => listErrors(query));

/** Purge des erreurs de plus de 30 jours. */
export const DELETE = adminRoute({}, async ({ auth }) => purgeErrors(auth.user.id, 30));
