import { describe, expect, it } from "vitest";
import { passwordSchema, registerSchema } from "@/lib/schemas/auth";
import { createCompanySchema } from "@/lib/schemas/company";
import { contactSchema } from "@/lib/schemas/contact";

describe("politique de mot de passe", () => {
  it.each([
    ["court", "Abc1!"],
    ["sans majuscule", "motdepasse-2026!"],
    ["sans minuscule", "MOTDEPASSE-2026!"],
    ["sans chiffre", "MotDePasse-Solide!"],
    ["sans caractère spécial", "MotDePasse2026xyz"],
  ])("refuse un mot de passe %s", (_label, value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });

  it("accepte un mot de passe conforme", () => {
    expect(passwordSchema.safeParse("Compta-Solide-2026!").success).toBe(true);
  });
});

describe("inscription", () => {
  const valid = { firstName: "Ada", lastName: "Martin", email: "  Ada.Martin@Exemple.FR ", password: "Compta-Solide-2026!", acceptTerms: true };

  it("normalise l'adresse e-mail et applique la formule par défaut", () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe("ada.martin@exemple.fr");
    expect(parsed.plan).toBe("PRO");
  });

  it("exige l'acceptation des conditions générales", () => {
    expect(registerSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });

  it("refuse le balisage HTML dans les noms", () => {
    expect(registerSchema.safeParse({ ...valid, firstName: "<script>alert(1)</script>" }).success).toBe(false);
  });
});

describe("entreprise", () => {
  const base = { name: "Atelier Test", legalForm: "SASU", taxRegime: "IS_REEL_SIMPLIFIE", vatRegime: "REEL_SIMPLIFIE" };

  it("accepte une société cohérente et normalise les identifiants", () => {
    const parsed = createCompanySchema.parse({ ...base, siren: "552 100 554", siret: "552 100 554 00013", vatNumber: "fr 96 552100554" });
    expect(parsed.siren).toBe("552100554");
    expect(parsed.siret).toBe("55210055400013");
    expect(parsed.vatNumber).toBe("FR96552100554");
    expect(parsed.fiscalYearStartMonth).toBe(1);
  });

  it("refuse un régime fiscal incompatible avec la forme juridique", () => {
    const result = createCompanySchema.safeParse({ ...base, legalForm: "MICRO_ENTREPRISE" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["taxRegime"]);
    expect(createCompanySchema.safeParse({ ...base, legalForm: "SA", taxRegime: "MICRO_BIC" }).success).toBe(false);
  });

  it("refuse un SIREN, un SIRET ou un numéro de TVA invalides", () => {
    expect(createCompanySchema.safeParse({ ...base, siren: "552100555" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...base, siret: "55210055400014" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...base, vatNumber: "FR00552100554" }).success).toBe(false);
  });

  it("refuse un SIRET qui n'appartient pas au SIREN", () => {
    expect(createCompanySchema.safeParse({ ...base, siren: "552100554", siret: "73282932000074" }).success).toBe(false);
  });

  it("impose l'année civile en micro-entreprise", () => {
    const micro = { name: "Micro", legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" };
    expect(createCompanySchema.safeParse(micro).success).toBe(true);
    expect(createCompanySchema.safeParse({ ...micro, fiscalYearStartMonth: 7 }).success).toBe(false);
  });
});

describe("formulaire de contact", () => {
  const valid = { name: "Ada Martin", email: "ada@exemple.fr", subject: "Question", message: "Bonjour, j'aimerais en savoir plus sur vos formules.", consent: true };

  it("accepte un message complet", () => {
    expect(contactSchema.safeParse(valid).success).toBe(true);
  });

  it("exige le consentement et un message suffisant", () => {
    expect(contactSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, message: "Trop court" }).success).toBe(false);
  });
});
