import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/server/env";
import { legalFormFromCategory, mapInseeEtablissement, mapPublicResult, searchCompanies } from "@/server/modules/insee/service";

const inseeEtablissement = {
  siren: "552100554",
  siret: "55210055400013",
  uniteLegale: {
    denominationUniteLegale: "ATELIER EXEMPLE",
    categorieJuridiqueUniteLegale: "5710",
    activitePrincipaleUniteLegale: "62.01Z",
    dateCreationUniteLegale: "2015-03-02",
    etatAdministratifUniteLegale: "A",
  },
  adresseEtablissement: {
    numeroVoieEtablissement: "12",
    typeVoieEtablissement: "RUE",
    libelleVoieEtablissement: "DES LUMIERES",
    codePostalEtablissement: "69001",
    libelleCommuneEtablissement: "LYON",
  },
};

const publicResult = {
  siren: "732829320",
  nom_complet: "studio exemple",
  nom_raison_sociale: "STUDIO EXEMPLE",
  nature_juridique: "5498",
  activite_principale: "74.10Z",
  date_creation: "2019-06-01",
  etat_administratif: "A",
  siege: { siret: "73282932000074", numero_voie: "3", type_voie: "PLACE", libelle_voie: "DU MARCHE", code_postal: "44000", libelle_commune: "NANTES" },
};

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (...args: [url: string, init?: RequestInit]) => {
    void args;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INSEE_API_KEY;
  resetEnvCache();
});

describe("recherche d'entreprises (répertoire Sirene)", () => {
  it("convertit les catégories juridiques INSEE", () => {
    expect(legalFormFromCategory("1000")).toBe("EI");
    expect(legalFormFromCategory("5498")).toBe("EURL");
    expect(legalFormFromCategory("5499")).toBe("SARL");
    expect(legalFormFromCategory("5710")).toBe("SAS");
    expect(legalFormFromCategory("5720")).toBe("SASU");
    expect(legalFormFromCategory("5599")).toBe("SA");
    expect(legalFormFromCategory("6540")).toBe("SCI");
    expect(legalFormFromCategory("9220")).toBe("ASSOCIATION");
    expect(legalFormFromCategory("3120")).toBe("OTHER");
    expect(legalFormFromCategory(null)).toBe("OTHER");
  });

  it("met en forme un établissement de l'API Sirene de l'INSEE", () => {
    expect(mapInseeEtablissement(inseeEtablissement)).toEqual({
      siren: "552100554",
      siret: "55210055400013",
      name: "ATELIER EXEMPLE",
      tradeName: null,
      legalForm: "SAS",
      legalCategoryCode: "5710",
      nafCode: "62.01Z",
      vatNumber: "FR96552100554",
      addressLine1: "12 RUE DES LUMIERES",
      postalCode: "69001",
      city: "LYON",
      registrationDate: "2015-03-02",
      active: true,
    });
  });

  it("gère un entrepreneur individuel sans dénomination", () => {
    const result = mapInseeEtablissement({
      siren: "732829320",
      uniteLegale: { prenomUsuelUniteLegale: "ADA", nomUniteLegale: "MARTIN", categorieJuridiqueUniteLegale: "1000", etatAdministratifUniteLegale: "C" },
    });
    expect(result?.name).toBe("ADA MARTIN");
    expect(result?.legalForm).toBe("EI");
    expect(result?.active).toBe(false);
  });

  it("met en forme un résultat de l'annuaire public", () => {
    const result = mapPublicResult(publicResult);
    expect(result).toMatchObject({
      siren: "732829320",
      siret: "73282932000074",
      name: "STUDIO EXEMPLE",
      legalForm: "EURL",
      addressLine1: "3 PLACE DU MARCHE",
      postalCode: "44000",
      city: "NANTES",
      vatNumber: "FR44732829320",
    });
  });

  it("interroge l'annuaire public en l'absence de clé INSEE", async () => {
    const fetchMock = mockFetch(200, { results: [publicResult] });
    const results = await searchCompanies("732 829 320");
    expect(results).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("recherche-entreprises.api.gouv.fr/search?q=732829320");
  });

  it("interroge l'API de l'INSEE avec la clé lorsqu'elle est configurée", async () => {
    process.env.INSEE_API_KEY = "cle-de-test";
    resetEnvCache();
    const fetchMock = mockFetch(200, { etablissement: inseeEtablissement });
    const results = await searchCompanies("55210055400013");
    expect(results[0].name).toBe("ATELIER EXEMPLE");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.insee.fr/api-sirene/3.11/siret/55210055400013");
    expect((init?.headers as Record<string, string>)["X-INSEE-Api-Key-Integration"]).toBe("cle-de-test");
  });

  it("retourne une liste vide si l'entreprise est inconnue", async () => {
    mockFetch(404, {});
    expect(await searchCompanies("552100554")).toEqual([]);
  });

  it("signale proprement une indisponibilité du service", async () => {
    mockFetch(500, {});
    await expect(searchCompanies("atelier")).rejects.toMatchObject({ status: 502, code: "COMPANY_LOOKUP_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
    await expect(searchCompanies("atelier")).rejects.toMatchObject({ status: 502 });
  });
});
