import { authRoute, noContent } from "@/server/http/api";
import { authorizeCompany } from "@/server/rbac/service";
import { deleteRecurringInvoice, setRecurringStatus } from "@/server/modules/invoicing/recurring";
import { recurringStatusSchema } from "@/lib/schemas/invoicing";

type Params = { companyId: string; recurringId: string };

export const PATCH = authRoute<Params, typeof recurringStatusSchema>({ body: recurringStatusSchema }, async ({ auth, params, body, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  await setRecurringStatus(access, auth.user.id, params.recurringId, body.status, meta);
  return { status: body.status };
});

export const DELETE = authRoute<Params>({}, async ({ auth, params, meta }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, "invoices:issue");
  await deleteRecurringInvoice(access, auth.user.id, params.recurringId, meta);
  return noContent();
});
