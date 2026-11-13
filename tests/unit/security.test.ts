import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "@/server/security/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { currentTotpCode, generateMfaSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotpCode } from "@/server/auth/mfa";

describe("chiffrement des secrets", () => {
  it("chiffre et déchiffre, avec un vecteur d'initialisation unique", () => {
    const first = encryptSecret("JBSWY3DPEHPK3PXP");
    const second = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(first).not.toBe(second);
    expect(first).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(first)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("détecte toute altération du contenu chiffré", () => {
    const [version, iv, tag, data] = encryptSecret("secret").split(".");
    const tampered = [version, iv, tag, Buffer.from("autre").toString("base64url") + data].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret("texte-en-clair")).toThrow();
  });

  it("génère des jetons imprévisibles dont seule l'empreinte est stockée", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

describe("mots de passe", () => {
  it("hache avec Argon2id et vérifie", async () => {
    const hash = await hashPassword("Compta-Solide-2026!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Compta-Solide-2026!")).toBe(true);
    expect(await verifyPassword(hash, "Compta-Solide-2026?")).toBe(false);
    expect(await verifyPassword("pas-une-empreinte", "x")).toBe(false);
  });
});

describe("double authentification TOTP", () => {
  it("accepte le code courant et celui du pas voisin, refuse les autres", () => {
    const { encryptedSecret, otpauthUrl } = generateMfaSecret("ada@exemple.fr");
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const now = new Date("2026-11-13T10:00:00Z");
    const code = currentTotpCode(encryptedSecret, now);
    expect(verifyTotpCode(encryptedSecret, code, now)).toBe(true);
    expect(verifyTotpCode(encryptedSecret, code, new Date(now.getTime() + 30_000))).toBe(true);
    expect(verifyTotpCode(encryptedSecret, code, new Date(now.getTime() + 120_000))).toBe(false);
    expect(verifyTotpCode(encryptedSecret, "000000", now) && code !== "000000").toBe(false);
    expect(verifyTotpCode(encryptedSecret, "abcdef", now)).toBe(false);
  });

  it("génère dix codes de secours uniques, stockés hachés", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashes[0]).toBe(hashRecoveryCode(codes[0].toLowerCase().replace("-", " ")));
    expect(hashes).not.toContain(codes[0]);
  });
});
