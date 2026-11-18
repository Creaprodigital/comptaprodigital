import { authRoute } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { disposeAsset } from "@/server/modules/accounting/assets";
import { assetDisposalSchema } from "@/lib/schemas/accounting";

export const POST = authRoute<{ companyId: string; assetId: string }, typeof assetDisposalSchema>({ body: assetDisposalSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return disposeAsset(access, auth.user.id, params.assetId, body, meta);
});
