import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { getBillingSettings, updateBillingSettings } from "@/server/modules/invoicing/settings";
import { billingSettingsSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string };

/** « keepIban » : conserve l'IBAN enregistré lorsque le champ n'a pas été ressaisi (il n'est jamais renvoyé en clair). */
const bodySchema = billingSettingsSchema.extend({ keepIban: z.boolean().default(false) });

export const GET = authRoute<Params>({}, async ({ auth, params }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:read");
  return getBillingSettings(access);
});

export const PATCH = authRoute<Params, typeof bodySchema>({ body: bodySchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "company:update");
  await updateBillingSettings(access, auth.user.id, body, meta);
  return getBillingSettings(await authorizeCompany(auth.user.id, params.companyId, "company:read"));
});
