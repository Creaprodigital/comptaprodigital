import { describe, expect, it } from "vitest";
import { frenchVatNumberFromSiren, isValidFrenchVatNumber, isValidSiren, isValidSiret } from "@/lib/identifiers";

describe("identifiants d'entreprise", () => {
  it("valide un SIREN par la clé de Luhn", () => {
    expect(isValidSiren("552100554")).toBe(true);
    expect(isValidSiren("552 100 554")).toBe(true);
    expect(isValidSiren("732829320")).toBe(true);
    expect(isValidSiren("552100555")).toBe(false);
    expect(isValidSiren("12345678")).toBe(false);
    expect(isValidSiren("abcdefghi")).toBe(false);
  });

  it("valide un SIRET, y compris le cas particulier de La Poste", () => {
    expect(isValidSiret("55210055400013")).toBe(true);
    expect(isValidSiret("73282932000074")).toBe(true);
    expect(isValidSiret("55210055400014")).toBe(false);
    expect(isValidSiret("35600000000048")).toBe(true);
    expect(isValidSiret("35600000049837")).toBe(true); // somme des chiffres multiple de 5
    expect(isValidSiret("35600000049838")).toBe(false);
  });

  it("calcule le numéro de TVA intracommunautaire à partir du SIREN", () => {
    // Exemple de référence couramment cité : SIREN 404 833 048 → FR 83 404833048.
    expect(frenchVatNumberFromSiren("404833048")).toBe("FR83404833048");
    expect(frenchVatNumberFromSiren("552100554")).toBe("FR96552100554");
    expect(frenchVatNumberFromSiren("732829320")).toBe("FR44732829320");
    expect(frenchVatNumberFromSiren("000000001")).toBeNull();
    expect(isValidFrenchVatNumber("FR96552100554")).toBe(true);
    expect(isValidFrenchVatNumber("fr 96 552100554")).toBe(true);
    expect(isValidFrenchVatNumber("FR97552100554")).toBe(false);
  });
});
