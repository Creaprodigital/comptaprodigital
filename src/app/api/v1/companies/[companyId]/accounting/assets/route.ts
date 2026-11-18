import { z } from "zod";
import { authRoute, created } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { assetsCsv, createAsset, listAssets } from "@/server/modules/accounting/assets";
import { fixedAssetSchema } from "@/lib/schemas/accounting";

type Params = { companyId: string };
const querySchema = z.object({ format: z.enum(["json", "csv"]).optional() });

export const GET = authRoute<Params, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:read");
  return query.format === "csv" ? csvResponse("immobilisations.csv", await assetsCsv(access)) : listAssets(access);
});

export const POST = authRoute<Params, typeof fixedAssetSchema>({ body: fixedAssetSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "accounting:write");
  return created(await createAsset(access, auth.user.id, body, meta));
});
