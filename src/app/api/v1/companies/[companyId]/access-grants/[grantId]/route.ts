import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { revokeGrant } from "@/server/modules/admin/access-grants";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";

/** Le titulaire (ou un administrateur de l'entreprise) peut révoquer un accès du support à tout moment. */
export const DELETE = authRoute<{ companyId: string; grantId: string }>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "members:read");
  const grant = await prisma.adminDataAccessGrant.findFirst({ where: { id: params.grantId, companyId: access.company.id }, select: { id: true } });
  if (!grant) throw errors.notFound("Accès introuvable.");
  await revokeGrant(auth.user.id, grant.id, "owner", meta);
  return noContent();
});
