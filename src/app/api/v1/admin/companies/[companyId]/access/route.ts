import { adminRoute, created } from "@/server/http/api";
import { listGrants, requestAccess } from "@/server/modules/admin/access-grants";
import { accessGrantSchema } from "@/lib/schemas/admin";

type Params = { companyId: string };

export const GET = adminRoute<Params>({}, async ({ params }) => listGrants(params.companyId));

/** Ouvre un accès justifié, limité dans le temps, aux données financières (le titulaire est prévenu). */
export const POST = adminRoute<Params, typeof accessGrantSchema>({ body: accessGrantSchema }, async ({ auth, params, body, meta }) => {
  const grant = await requestAccess(auth.user.id, params.companyId, body, meta);
  return created({ id: grant.id, expiresAt: grant.expiresAt.toISOString() });
});
