import * as OTPAuth from "otpauth";
import { randomBytes } from "node:crypto";
import { siteConfig } from "@/config/site";
import { decryptSecret, encryptSecret, sha256Hex } from "@/server/security/crypto";

/** Double authentification TOTP (RFC 6238), compatible avec toutes les applications d'authentification. */

function buildTotp(secretBase32: string, accountLabel: string) {
  return new OTPAuth.TOTP({
    issuer: siteConfig.name,
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function generateMfaSecret(accountLabel: string): { secretBase32: string; encryptedSecret: string; otpauthUrl: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = buildTotp(secret.base32, accountLabel);
  return { secretBase32: secret.base32, encryptedSecret: encryptSecret(secret.base32), otpauthUrl: totp.toString() };
}

export function verifyTotpCode(encryptedSecret: string, code: string, at: Date = new Date()): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const totp = buildTotp(decryptSecret(encryptedSecret), "verification");
  // Tolérance d'un pas (±30 s) pour absorber les décalages d'horloge.
  return totp.validate({ token: normalized, window: 1, timestamp: at.getTime() }) !== null;
}

/** Code TOTP courant — utilisé uniquement par les tests. */
export function currentTotpCode(encryptedSecret: string, at: Date = new Date()): string {
  return buildTotp(decryptSecret(encryptedSecret), "verification").generate({ timestamp: at.getTime() });
}

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Codes de secours à usage unique (format XXXXX-XXXXX), stockés hachés. */
export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function normalizeRecoveryCode(code: string): string {
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(`recovery:${normalizeRecoveryCode(code)}`);
}
