import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/server/env";
import { AppError, errors } from "@/server/http/errors";
import { enforceRateLimit, type RateLimitRule } from "@/server/security/rate-limit";
import { resolveSession, type AuthContext } from "@/server/auth/session";
import { prisma } from "@/server/db";

/**
 * Enveloppe commune à toutes les routes de l'API REST (/api/v1) :
 *  - contrôle d'origine (anti-CSRF) sur les méthodes mutatrices ;
 *  - limitation de débit ;
 *  - authentification par cookie de session ;
 *  - validation Zod du corps et des paramètres de requête ;
 *  - format de réponse homogène : { data } ou { error: { code, message, details } }.
 */

export type RequestMeta = {
  ip: string;
  userAgent: string | null;
};

type BaseContext<P, B, Q> = {
  request: NextRequest;
  params: P;
  body: B;
  query: Q;
  meta: RequestMeta;
};

export type PublicContext<P, B, Q> = BaseContext<P, B, Q> & { auth: AuthContext | null };
export type AuthedContext<P, B, Q> = BaseContext<P, B, Q> & { auth: AuthContext };

type RouteOptions<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> = {
  body?: B;
  query?: Q;
  rateLimit?: RateLimitRule;
};

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
type NextRouteContext<P> = { params: Promise<P> };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function getRequestMeta(request: NextRequest): RequestMeta {
  // Derrière le reverse proxy (Nginx/Caddy), l'adresse du client est la première de X-Forwarded-For.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return { ip: ip.slice(0, 64), userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null };
}

/**
 * Protection CSRF : les navigateurs envoient toujours l'en-tête Origin sur les
 * requêtes mutatrices. Toute origine différente de celle de l'application est
 * refusée ; le cookie de session est par ailleurs SameSite=Lax.
 */
function assertSameOrigin(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new AppError(403, "CSRF_REJECTED", "Origine de la requête non autorisée.");
    }
    return;
  }
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    if (env().NODE_ENV !== "production") allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) {
    throw new AppError(403, "CSRF_REJECTED", "Origine de la requête non autorisée.");
  }
}

async function parseBody<B extends z.ZodType>(request: NextRequest, schema: B): Promise<z.infer<B>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Le corps de la requête doit être au format JSON.");
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw errors.badRequest("INVALID_JSON", "Le corps de la requête n'est pas un JSON valide.");
  }
  return validate(schema, json);
}

export function validate<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw errors.validation(result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  return result.data;
}

function errorResponse(error: unknown, request: NextRequest): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Erreur inattendue : on journalise côté serveur, sans rien divulguer au client.
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[api] ${request.method} ${request.nextUrl.pathname}`, err);
  void prisma.applicationError
    .create({
      data: {
        message: err.message.slice(0, 5000),
        stack: err.stack?.slice(0, 20000),
        path: request.nextUrl.pathname.slice(0, 255),
        method: request.method,
      },
    })
    .catch(() => undefined);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Une erreur inattendue est survenue. Veuillez réessayer." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json({ data: result ?? null }, { headers: { "Cache-Control": "no-store" } });
}

async function buildContext<P, B extends z.ZodType | undefined, Q extends z.ZodType | undefined>(
  request: NextRequest,
  routeContext: NextRouteContext<P>,
  options: RouteOptions<B, Q>,
): Promise<BaseContext<P, Infer<B>, Infer<Q>>> {
  assertSameOrigin(request);
  const meta = getRequestMeta(request);
  if (options.rateLimit) await enforceRateLimit(options.rateLimit, meta.ip);
  const params = await routeContext.params;
  const query = options.query
    ? validate(options.query, Object.fromEntries(request.nextUrl.searchParams.entries()))
    : undefined;
  const body = options.body ? await parseBody(request, options.body) : undefined;
  return { request, params, body: body as Infer<B>, query: query as Infer<Q>, meta };
}

/** Route accessible sans authentification (la session éventuelle est tout de même résolue). */
export function publicRoute<
  P = Record<string, never>,
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
>(options: RouteOptions<B, Q>, handler: (ctx: PublicContext<P, Infer<B>, Infer<Q>>) => Promise<unknown>) {
  return async (request: NextRequest, routeContext: NextRouteContext<P>): Promise<Response> => {
    try {
      const base = await buildContext(request, routeContext, options);
      const auth = await resolveSession();
      return toResponse(await handler({ ...base, auth }));
    } catch (error) {
      // Les signaux internes de Next.js (sortie du prérendu, redirections) ne sont pas des erreurs applicatives.
      unstable_rethrow(error);
      return errorResponse(error, request);
    }
  };
}

/** Route réservée aux utilisateurs authentifiés (second facteur validé le cas échéant). */
export function authRoute<
  P = Record<string, never>,
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
>(options: RouteOptions<B, Q>, handler: (ctx: AuthedContext<P, Infer<B>, Infer<Q>>) => Promise<unknown>) {
  return async (request: NextRequest, routeContext: NextRouteContext<P>): Promise<Response> => {
    try {
      const base = await buildContext(request, routeContext, options);
      const auth = await resolveSession();
      if (!auth) throw errors.unauthenticated();
      return toResponse(await handler({ ...base, auth }));
    } catch (error) {
      // Les signaux internes de Next.js (sortie du prérendu, redirections) ne sont pas des erreurs applicatives.
      unstable_rethrow(error);
      return errorResponse(error, request);
    }
  };
}

export function created(data: unknown): Response {
  return NextResponse.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Route de l'administration : session valide, super administrateur, double
 * authentification activée. Les autres comptes reçoivent une 404.
 */
export function adminRoute<
  P = Record<string, never>,
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
>(options: RouteOptions<B, Q>, handler: (ctx: AuthedContext<P, Infer<B>, Infer<Q>>) => Promise<unknown>) {
  return authRoute<P, B, Q>(options, async (ctx) => {
    const { assertSuperAdmin } = await import("@/server/admin/guard-core");
    assertSuperAdmin(ctx.auth);
    return handler(ctx);
  });
}
