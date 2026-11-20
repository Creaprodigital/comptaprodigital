import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Politique de sécurité du contenu. Les scripts en ligne restent autorisés : l'application
 * repose sur le prérendu partiel (cacheComponents), incompatible avec une CSP par nonce
 * (documentation Next.js, « Content Security Policy »). En compensation : intégrité des
 * scripts (SRI, empreintes calculées au build), aucune source externe, aucun eval en
 * production, et rapports de violation consignés côté serveur.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "report-uri /api/v1/csp-report",
  "report-to csp",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Reporting-Endpoints", value: 'csp="/api/v1/csp-report"' },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

/**
 * Contenu d'un document (PDF, image) servi par l'API : il peut être affiché dans un
 * cadre de l'application elle-même, et ne peut ni exécuter de script ni charger de ressource.
 */
const documentContentPath = "api/v1/companies/[^/]+/documents/[^/]+/content";
const documentHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ...securityHeaders.filter((header) => !["Content-Security-Policy", "X-Frame-Options"].includes(header.key)),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Sortie autonome pour l'image Docker (activée par le Dockerfile).
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", "pdfkit"],
  // Fichiers lus à l'exécution (image Docker autonome) : polices incorporées aux PDF et données de PDFKit
  // (métriques, profil de couleurs sRGB exigé par le PDF/A).
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/**/*", "./node_modules/pdfkit/js/data/**/*"],
  },
  experimental: {
    // Envoi de justificatifs (10 Mo au plus par fichier, contrôlé par l'API) : marge pour l'enveloppe multipart.
    proxyClientMaxBodySize: "12mb",
    // Intégrité des scripts : empreinte SHA-256 de chaque fichier JavaScript, vérifiée par le navigateur.
    sri: { algorithm: "sha256" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Tout le site, sauf le contenu des documents (aperçu dans un cadre de la même origine, ci-dessous).
      { source: `/((?!${documentContentPath}).*)`, headers: securityHeaders },
      { source: "/api/v1/companies/:companyId/documents/:documentId/content", headers: documentHeaders },
      // Les pages de l'espace client et l'API ne doivent jamais être mises en cache par un intermédiaire.
      { source: "/app/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
