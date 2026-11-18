import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { AppError } from "@/server/http/errors";
import { processWebhook } from "@/server/billing/webhooks";

/**
 * Point d'entrée des webhooks Stripe. Pas de session ni de contrôle d'origine :
 * l'authenticité de l'appel repose sur la signature, vérifiée sur le corps brut.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Corps trop volumineux." } }, { status: 413 });
  try {
    return NextResponse.json(await processWebhook(body, request.headers.get("stripe-signature")));
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[stripe] traitement du webhook", err);
    await prisma.applicationError.create({ data: { message: `Webhook Stripe : ${err.message}`.slice(0, 5000), stack: err.stack?.slice(0, 20000), path: "/api/v1/stripe/webhook", method: "POST" } }).catch(() => undefined);
    // 500 : Stripe renverra l'événement.
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Traitement impossible." } }, { status: 500 });
  }
}
