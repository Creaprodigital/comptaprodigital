/** Client HTTP du navigateur pour l'API REST interne (/api/v1). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Erreurs de validation indexées par champ. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== "VALIDATION_ERROR" || !Array.isArray(this.details)) return {};
    const result: Record<string, string> = {};
    for (const item of this.details as Array<{ path?: string; message?: string }>) {
      if (item.path && item.message && !result[item.path]) result[item.path] = item.message;
    }
    return result;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

type Payload<T> = { data?: T; error?: { code: string; message: string; details?: unknown } } | null;

function unwrap<T>(response: Response, payload: Payload<T>): T {
  if (!response.ok || !payload) {
    const error = payload?.error;
    throw new ApiError(response.status, error?.code ?? "UNKNOWN_ERROR", error?.message ?? "Une erreur inattendue est survenue. Veuillez réessayer.", error?.details);
  }
  return payload.data as T;
}

/** Envoi de fichiers (multipart/form-data) : le navigateur fixe lui-même l'en-tête et sa frontière. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Connexion au serveur impossible. Vérifiez votre réseau et réessayez.");
  }
  return unwrap<T>(response, (await response.json().catch(() => null)) as Payload<T>);
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Connexion au serveur impossible. Vérifiez votre réseau et réessayez.");
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!response.ok || !payload) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN_ERROR",
      error?.message ?? "Une erreur inattendue est survenue. Veuillez réessayer.",
      error?.details,
    );
  }
  return payload.data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Une erreur inattendue est survenue. Veuillez réessayer.";
}
