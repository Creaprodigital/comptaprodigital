import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { env } from "@/server/env";
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE } from "@/server/auth/constants";
import { validateSessionToken, type AuthContext } from "@/server/auth/session-store";

export type { AuthContext } from "@/server/auth/session-store";

function isSecureContext(): boolean {
  return env().APP_URL.startsWith("https://");
}

export function sessionCookieName(): string {
  return isSecureContext() ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
}

/** Dépose le cookie de session : httpOnly, SameSite=Lax, Secure en HTTPS. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

/** Session courante (dédupliquée par requête lors du rendu serveur). */
export const resolveSession = cache(async (): Promise<AuthContext | null> => {
  const token = await readSessionToken();
  return token ? validateSessionToken(token) : null;
});

/** Session en attente du second facteur (étape 2 de la connexion). */
export async function resolvePendingMfaSession(): Promise<AuthContext | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const auth = await validateSessionToken(token, { allowMfaPending: true });
  return auth?.session.mfaPending ? auth : null;
}
