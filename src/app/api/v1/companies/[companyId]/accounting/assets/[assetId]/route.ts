import { authRoute, noContent } from "@/server/http/api";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { deleteAsset, getAsset, getAssetHistory, updateAsset } from "@/server/modules/accounting/assets";
import { fixedAssetSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string; assetId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  const [asset, history] = await Promise.all([getAsset(access, params.assetId), getAssetHistory(access, params.assetId)]);
  return { asset, history };
});

export const PUT = authRoute<Params, typeof fixedAssetSchema>({ body: fixedAssetSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return updateAsset(access, auth.user.id, params.assetId, body, meta);
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  await deleteAsset(access, auth.user.id, params.assetId, meta);
  return noContent();
});
