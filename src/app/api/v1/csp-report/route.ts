import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { getRequestMeta } from "@/server/http/api";
import { consumeRateLimit } from "@/server/security/rate-limit";

/**
 * Rapports de violation de la politique de sécurité du contenu (CSP), envoyés par les
 * navigateurs (formats « report-uri » et « Reporting API »). Ils sont consignés dans les
 * erreurs applicatives, visibles dans l'administration, avec un débit limité par adresse.
 */

const MAX_BYTES = 16 * 1024;
const RULE = { name: "csp.report", limit: 30, windowSeconds: 60 * 60 };

type Report = { "blocked-uri"?: string; blockedURL?: string; "violated-directive"?: string; effectiveDirective?: string; "document-uri"?: string; documentURL?: string };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  const { ip } = getRequestMeta(request);
  const { allowed } = await consumeRateLimit(RULE, ip);
  if (!allowed) return new NextResponse(null, { status: 204 });
  let reports: Report[] = [];
  try {
    const parsed = JSON.parse(raw) as { "csp-report"?: Report } | Array<{ type?: string; body?: Report }>;
    reports = Array.isArray(parsed) ? parsed.filter((r) => r.type === "csp-violation" && r.body).map((r) => r.body!) : parsed["csp-report"] ? [parsed["csp-report"]] : [];
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  for (const report of reports.slice(0, 5)) {
    const directive = report.effectiveDirective ?? report["violated-directive"] ?? "?";
    const blocked = report.blockedURL ?? report["blocked-uri"] ?? "?";
    // Seule l'origine et le chemin de la page sont conservés (pas les paramètres, qui peuvent contenir des données).
    let page = report.documentURL ?? report["document-uri"] ?? "";
    try {
      page = new URL(page).pathname;
    } catch {
      page = "";
    }
    await prisma.applicationError
      .create({ data: { message: `Violation CSP : ${directive} a bloqué ${String(blocked).slice(0, 300)}`, path: `csp:${page}`.slice(0, 255), method: "CSP" } })
      .catch(() => undefined);
  }
  return new NextResponse(null, { status: 204 });
}
