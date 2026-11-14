import { NextResponse } from "next/server";
import { authRoute, noContent } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { authorizeCompany } from "@/server/rbac/service";
import { deleteLogo, getLogo, saveLogo } from "@/server/modules/invoicing/settings";
import { logoSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:read");
  const logo = await getLogo(access.company.id);
  if (!logo) throw errors.notFound("Aucun logo enregistré.");
  return new NextResponse(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

export const PUT = authRoute<Params, typeof logoSchema>({ body: logoSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  await saveLogo(access, auth.user.id, body, meta);
  return { saved: true };
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  await deleteLogo(access, auth.user.id, meta);
  return noContent();
});
