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

function encryptionKey(): Buffer {
  return Buffer.from(env().APP_ENCRYPTION_KEY, "base64");
}

/**
 * Chiffrement authentifié AES-256-GCM des secrets stockés en base
 * (secret TOTP, IBAN). Format : v1.<iv>.<tag>.<données>, en base64url.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Format de secret chiffré invalide");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
