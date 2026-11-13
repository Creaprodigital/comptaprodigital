import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app/", "/api/", "/invitation/", "/verification-email", "/reinitialiser-mot-de-passe"] }],
    sitemap: `${siteConfig.url.replace(/\/$/, "")}/sitemap.xml`,
  };
}
