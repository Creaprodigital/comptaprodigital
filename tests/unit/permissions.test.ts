import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "@/server/rbac/permissions";

const has = (role: keyof typeof ROLE_DEFINITIONS, permission: string) =>
  (ROLE_DEFINITIONS[role].permissions as string[]).includes(permission);

describe("matrice des rôles", () => {
  it("le propriétaire dispose de toutes les permissions", () => {
    expect(new Set(ROLE_DEFINITIONS.OWNER.permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it("l'administrateur ne peut pas archiver l'entreprise", () => {
    expect(has("COMPANY_ADMIN", "company:delete")).toBe(false);
    expect(has("COMPANY_ADMIN", "members:manage")).toBe(true);
  });

  it("la lecture seule n'a aucune permission d'écriture", () => {
    for (const permission of ROLE_DEFINITIONS.READ_ONLY.permissions) {
      expect(permission.endsWith(":read")).toBe(true);
    }
  });

  it("le collaborateur gère l'activité courante mais ni les accès, ni la clôture", () => {
    expect(has("COLLABORATOR", "invoices:write")).toBe(true);
    expect(has("COLLABORATOR", "bank:write")).toBe(true);
    expect(has("COLLABORATOR", "members:manage")).toBe(false);
    expect(has("COLLABORATOR", "company:update")).toBe(false);
    expect(has("COLLABORATOR", "accounting:close")).toBe(false);
    expect(has("COLLABORATOR", "vat:validate")).toBe(false);
  });

  it("l'expert-comptable externe saisit et clôture, sans toucher à la facturation ni aux accès", () => {
    expect(has("EXTERNAL_ACCOUNTANT", "accounting:write")).toBe(true);
    expect(has("EXTERNAL_ACCOUNTANT", "accounting:close")).toBe(true);
    expect(has("EXTERNAL_ACCOUNTANT", "exports:run")).toBe(true);
    expect(has("EXTERNAL_ACCOUNTANT", "invoices:write")).toBe(false);
    expect(has("EXTERNAL_ACCOUNTANT", "invoices:issue")).toBe(false);
    expect(has("EXTERNAL_ACCOUNTANT", "members:manage")).toBe(false);
  });
});
