import { env } from "@/server/env";
import { AppError } from "@/server/http/errors";
import type { LegalFormKey } from "@/config/legal";
import { frenchVatNumberFromSiren, isValidSiren, isValidSiret, normalizeDigits } from "@/lib/identifiers";

/**
 * Recherche d'entreprises dans le répertoire Sirene.
 *
 *  - Si INSEE_API_KEY est défini : API Sirene officielle de l'INSEE (v3.11).
 *  - Sinon : API publique « Recherche d'entreprises » (annuaire-entreprises.data.gouv.fr),
 *    alimentée par les mêmes données Sirene, sans authentification.
 *
 * Seules des données publiques d'entreprises sont récupérées. Les résultats
 * pré-remplissent le formulaire : l'utilisateur les vérifie avant validation.
 */

export type CompanyLookupResult = {
  siren: string;
  siret: string | null;
  name: string;
  tradeName: string | null;
  legalForm: LegalFormKey;
  legalCategoryCode: string | null;
  nafCode: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  registrationDate: string | null;
  active: boolean;
};

const INSEE_BASE_URL = "https://api.insee.fr/api-sirene/3.11";
const PUBLIC_BASE_URL = "https://recherche-entreprises.api.gouv.fr";
const TIMEOUT_MS = 8000;

/** Correspondance entre la catégorie juridique INSEE (4 chiffres) et les formes proposées. */
export function legalFormFromCategory(code: string | null | undefined): LegalFormKey {
  if (!code) return "OTHER";
  if (code === "1000") return "EI";
  if (code === "5498") return "EURL";
  if (code.startsWith("54")) return "SARL";
  if (code === "5720") return "SASU";
  if (code.startsWith("57")) return "SAS";
  if (code.startsWith("55") || code.startsWith("56")) return "SA";
  if (code.startsWith("65")) return "SCI";
  if (code.startsWith("92")) return "ASSOCIATION";
  return "OTHER";
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const value = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new AppError(502, "COMPANY_LOOKUP_UNAVAILABLE", "Le service de recherche d'entreprises est momentanément indisponible. Vous pouvez saisir les informations manuellement.");
  }
  if (response.status === 404) return { status: 404, json: null };
  if (response.status === 429) {
    throw new AppError(503, "COMPANY_LOOKUP_BUSY", "Le service de recherche d'entreprises est saturé. Réessayez dans un instant.");
  }
  if (!response.ok) {
    throw new AppError(502, "COMPANY_LOOKUP_UNAVAILABLE", "Le service de recherche d'entreprises est momentanément indisponible. Vous pouvez saisir les informations manuellement.");
  }
  return { status: response.status, json: await response.json() };
}

// --- API Sirene de l'INSEE --------------------------------------------------

type InseeEtablissement = {
  siren?: string;
  siret?: string;
  uniteLegale?: {
    denominationUniteLegale?: string | null;
    denominationUsuelle1UniteLegale?: string | null;
    nomUniteLegale?: string | null;
    nomUsageUniteLegale?: string | null;
    prenom1UniteLegale?: string | null;
    prenomUsuelUniteLegale?: string | null;
    categorieJuridiqueUniteLegale?: string | null;
    activitePrincipaleUniteLegale?: string | null;
    dateCreationUniteLegale?: string | null;
    etatAdministratifUniteLegale?: string | null;
  };
  adresseEtablissement?: {
    numeroVoieEtablissement?: string | null;
    indiceRepetitionEtablissement?: string | null;
    typeVoieEtablissement?: string | null;
    libelleVoieEtablissement?: string | null;
    codePostalEtablissement?: string | null;
    libelleCommuneEtablissement?: string | null;
  };
  periodesEtablissement?: Array<{ enseigne1Etablissement?: string | null; etatAdministratifEtablissement?: string | null }>;
};

export function mapInseeEtablissement(etab: InseeEtablissement): CompanyLookupResult | null {
  const siren = etab.siren ?? etab.siret?.slice(0, 9);
  if (!siren) return null;
  const ul = etab.uniteLegale ?? {};
  const address = etab.adresseEtablissement ?? {};
  const personName = joinAddress([ul.prenomUsuelUniteLegale ?? ul.prenom1UniteLegale, ul.nomUsageUniteLegale ?? ul.nomUniteLegale]);
  const name = ul.denominationUniteLegale ?? personName;
  if (!name) return null;
  return {
    siren,
    siret: etab.siret ?? null,
    name,
    tradeName: ul.denominationUsuelle1UniteLegale ?? etab.periodesEtablissement?.[0]?.enseigne1Etablissement ?? null,
    legalForm: legalFormFromCategory(ul.categorieJuridiqueUniteLegale),
    legalCategoryCode: ul.categorieJuridiqueUniteLegale ?? null,
    nafCode: ul.activitePrincipaleUniteLegale ?? null,
    vatNumber: frenchVatNumberFromSiren(siren),
    addressLine1: joinAddress([
      address.numeroVoieEtablissement,
      address.indiceRepetitionEtablissement,
      address.typeVoieEtablissement,
      address.libelleVoieEtablissement,
    ]),
    postalCode: address.codePostalEtablissement ?? null,
    city: address.libelleCommuneEtablissement ?? null,
    registrationDate: ul.dateCreationUniteLegale ?? null,
    active: ul.etatAdministratifUniteLegale !== "C",
  };
}

async function searchInsee(query: string, apiKey: string): Promise<CompanyLookupResult[]> {
  const digits = normalizeDigits(query);
  const headers = { "X-INSEE-Api-Key-Integration": apiKey };

  if (isValidSiret(digits)) {
    const { status, json } = await fetchJson(`${INSEE_BASE_URL}/siret/${digits}`, headers);
    if (status === 404) return [];
    const mapped = mapInseeEtablissement((json as { etablissement?: InseeEtablissement }).etablissement ?? {});
    return mapped ? [mapped] : [];
  }

  const criteria = isValidSiren(digits)
    ? `siren:${digits} AND etablissementSiege:true`
    : `denominationUniteLegale:"${query.replace(/["\\]/g, " ")}" AND etablissementSiege:true AND etatAdministratifUniteLegale:A`;
  const url = `${INSEE_BASE_URL}/siret?q=${encodeURIComponent(criteria)}&nombre=8`;
  const { status, json } = await fetchJson(url, headers);
  if (status === 404) return [];
  const etablissements = (json as { etablissements?: InseeEtablissement[] }).etablissements ?? [];
  return etablissements.map(mapInseeEtablissement).filter((r): r is CompanyLookupResult => r !== null);
}

// --- API publique « Recherche d'entreprises » -------------------------------

type PublicResult = {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  nature_juridique?: string | null;
  activite_principale?: string | null;
  date_creation?: string | null;
  etat_administratif?: string | null;
  siege?: {
    siret?: string | null;
    numero_voie?: string | null;
    indice_repetition?: string | null;
    type_voie?: string | null;
    libelle_voie?: string | null;
    code_postal?: string | null;
    libelle_commune?: string | null;
    nom_commercial?: string | null;
  };
};

export function mapPublicResult(result: PublicResult): CompanyLookupResult | null {
  if (!result.siren) return null;
  const name = result.nom_raison_sociale ?? result.nom_complet;
  if (!name) return null;
  const siege = result.siege ?? {};
  return {
    siren: result.siren,
    siret: siege.siret ?? null,
    name: name.toUpperCase() === name ? name : name.trim(),
    tradeName: siege.nom_commercial ?? result.sigle ?? null,
    legalForm: legalFormFromCategory(result.nature_juridique),
    legalCategoryCode: result.nature_juridique ?? null,
    nafCode: result.activite_principale ?? null,
    vatNumber: frenchVatNumberFromSiren(result.siren),
    addressLine1: joinAddress([siege.numero_voie, siege.indice_repetition, siege.type_voie, siege.libelle_voie]),
    postalCode: siege.code_postal ?? null,
    city: siege.libelle_commune ?? null,
    registrationDate: result.date_creation ?? null,
    active: result.etat_administratif !== "C",
  };
}

async function searchPublicDirectory(query: string): Promise<CompanyLookupResult[]> {
  const digits = normalizeDigits(query);
  const term = /^\d{9}(\d{5})?$/.test(digits) ? digits : query;
  const url = `${PUBLIC_BASE_URL}/search?q=${encodeURIComponent(term)}&page=1&per_page=8`;
  const { status, json } = await fetchJson(url, {});
  if (status === 404) return [];
  const results = (json as { results?: PublicResult[] }).results ?? [];
  return results.map(mapPublicResult).filter((r): r is CompanyLookupResult => r !== null);
}

/** Recherche par SIREN, SIRET ou dénomination. */
export async function searchCompanies(query: string): Promise<CompanyLookupResult[]> {
  const apiKey = env().INSEE_API_KEY;
  return apiKey ? searchInsee(query, apiKey) : searchPublicDirectory(query);
}
