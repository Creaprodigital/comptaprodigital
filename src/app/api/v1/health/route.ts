import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";

/** Sonde de disponibilité (supervision, healthcheck Docker). */
export async function GET(request: NextRequest) {
  void request.headers;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
