import { hash, verify } from "@node-rs/argon2";

/**
 * Hachage des mots de passe avec Argon2id (paramètres conformes aux
 * recommandations OWASP : 19 Mio de mémoire, 2 itérations).
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Vérifie un mot de passe contre une empreinte factice, afin que le temps de
 * réponse soit le même que le compte existe ou non (anti-énumération).
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("mot-de-passe-factice-anti-enumeration");
  await verifyPassword(await dummyHash, password);
}
