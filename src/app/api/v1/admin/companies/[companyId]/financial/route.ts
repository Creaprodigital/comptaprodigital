import { adminRoute } from "@/server/http/api";
import { financialSnapshot } from "@/server/modules/admin/access-grants";

/** Synthèse financière en lecture seule, uniquement pendant un accès justifié ; chaque appel est journalisé. */
export const GET = adminRoute<{ companyId: string }>({}, async ({ auth, params, meta }) => financialSnapshot(auth.user.id, params.companyId, meta));
