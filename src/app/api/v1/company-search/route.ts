import { authRoute } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import { searchCompanies } from "@/server/modules/insee/service";
import { companySearchSchema } from "@/lib/schemas/company";

/** Recherche d'une entreprise par SIREN, SIRET ou dénomination (répertoire Sirene). */
export const GET = authRoute<Record<string, never>, undefined, typeof companySearchSchema>(
  { query: companySearchSchema, rateLimit: RATE_LIMITS.companySearch },
  async ({ query }) => searchCompanies(query.q),
);
