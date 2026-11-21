import { NextResponse } from "next/server";
import { authRoute } from "@/server/http/api";
import { env } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { completeBankConnection } from "@/server/modules/bank/connections";

/**
 * Retour du parcours Bridge Connect (callback_url). L'utilisateur doit être connecté ; le paramètre
 * « context » rattache le retour à sa demande. Il est ensuite renvoyé vers ses comptes bancaires.
 */
export const GET = authRoute({}, async ({ auth, request, meta }) => {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  let code: string;
  try {
    const outcome = await completeBankConnection(auth.user.id, params, meta);
    code = outcome.status === "connected" ? (outcome.sync.error ? "synchro-differee" : "ok") : outcome.status === "cancelled" ? "annulee" : outcome.status === "expired" ? "expiree" : "invalide";
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    code = error.status === 403 || error.status === 404 ? "invalide" : "erreur";
  }
  return NextResponse.redirect(new URL(`/app/banque/comptes?connexion=${code}`, env().APP_URL), 303);
});
