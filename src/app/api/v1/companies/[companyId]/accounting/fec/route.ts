import { NextResponse } from "next/server";
import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { contentDisposition } from "@/server/http/upload";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { authorizeAccounting } from "@/server/modules/accounting/access";
import { buildFec } from "@/server/modules/accounting/fec";

const querySchema = z.object({ fiscalYearId: z.string().min(1).max(40) });

/** Fichier des écritures comptables (écritures validées de l'exercice). */
export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema, rateLimit: RATE_LIMITS.exports }, async ({ auth, params, query, meta }) => {
  const access = await authorizeAccounting(auth.user.id, params.companyId, "exports:run");
  const { fileName, content } = await buildFec(access, auth.user.id, query.fiscalYearId, meta);
  return new NextResponse(new Uint8Array(content), {
    headers: { "Content-Type": "text/plain; charset=iso-8859-15", "Content-Disposition": contentDisposition("attachment", fileName), "Cache-Control": "private, no-store" },
  });
});
