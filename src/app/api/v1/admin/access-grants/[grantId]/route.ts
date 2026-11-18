import { adminRoute, noContent } from "@/server/http/api";
import { revokeGrant } from "@/server/modules/admin/access-grants";

export const DELETE = adminRoute<{ grantId: string }>({}, async ({ auth, params, meta }) => {
  await revokeGrant(auth.user.id, params.grantId, "admin", meta);
  return noContent();
});
