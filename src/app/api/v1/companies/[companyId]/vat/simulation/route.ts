import { authRoute } from "@/server/http/api";
import { authorizeVat } from "@/server/modules/accounting/access";
import { vatSimulation } from "@/server/modules/vat/service";

export const GET = authRoute<{ companyId: string }>({}, async ({ auth, params }) => {
  const access = await authorizeVat(auth.user.id, params.companyId, "vat:read");
  return vatSimulation(access);
});
