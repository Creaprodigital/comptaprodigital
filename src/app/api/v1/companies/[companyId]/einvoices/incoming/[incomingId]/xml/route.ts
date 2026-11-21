import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { incomingXml } from "@/server/modules/einvoicing/service";

type Params = { companyId: string; incomingId: string };

export const GET = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "purchases:read");
  const { fileName, xml } = await incomingXml(access, auth.user.id, params.incomingId, meta);
  return new Response(new Uint8Array(xml), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});
