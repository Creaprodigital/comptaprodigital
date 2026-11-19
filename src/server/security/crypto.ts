import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/** Jeton opaque (256 bits) destiné aux cookies de session et aux liens à usage unique. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Les jetons ne sont jamais stockés en clair : seule leur empreinte SHA-256 est en base. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/** Clé courante, puis l'éventuelle clé précédente (rotation en cours). */
export function encryptionKeys(): Buffer[] {
  const config = env();
  return [config.APP_ENCRYPTION_KEY, config.APP_ENCRYPTION_KEY_PREVIOUS].filter((k): k is string => Boolean(k)).map((k) => Buffer.from(k, "base64"));
}

/**
 * Chiffrement authentifié AES-256-GCM des secrets stockés en base
 * (secret TOTP, IBAN). Format : v1.<iv>.<tag>.<données>, en base64url.
 * Le chiffrement utilise toujours la clé courante ; le déchiffrement essaie aussi la clé
 * précédente pendant une rotation.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeys()[0], iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptWith(key: Buffer, payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Format de secret chiffré invalide");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function decryptSecret(payload: string): string {
  return decryptSecretWithKeyIndex(payload).plaintext;
}

/** Déchiffre et indique quelle clé a servi (0 = courante) : utilisé par la rotation. */
export function decryptSecretWithKeyIndex(payload: string): { plaintext: string; keyIndex: number } {
  const keys = encryptionKeys();
  let lastError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      return { plaintext: decryptWith(keys[i], payload), keyIndex: i };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
