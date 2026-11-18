import { authRoute } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { authorizeVat } from "@/server/modules/accounting/access";
import { getVatPeriod, vatPeriodAction } from "@/server/modules/vat/service";
import { vatPeriodActionSchema } from "@/lib/schemas/accounting";
import { isIsoDate } from "@/lib/dates";

type Params = { companyId: string; startDate: string };

function startOf(params: Params): string {
  if (!isIsoDate(params.startDate)) throw errors.notFound("Période de TVA introuvable.");
  return params.startDate;
}

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeVat(auth.user.id, params.companyId, "vat:read");
  return getVatPeriod(access, startOf(params));
});

/** Préparer, valider (droit « vat:validate »), indiquer le dépôt ou rouvrir. Rien n'est transmis à l'administration. */
export const POST = authRoute<Params, typeof vatPeriodActionSchema>({ body: vatPeriodActionSchema }, async ({ auth, params, body, meta }) => {
  const permission = body.action === "prepare" ? "vat:write" : "vat:validate";
  const access = await authorizeVat(auth.user.id, params.companyId, permission);
  return vatPeriodAction(access, auth.user.id, startOf(params), body.action, meta);
});
