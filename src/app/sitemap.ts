import type { MetadataRoute } from "next";
import { blogPosts } from "@/config/blog";
import { solutions } from "@/config/marketing";
import { siteConfig } from "@/config/site";

const staticPaths = [
  "",
  "/fonctionnalites",
  "/facturation",
  "/comptabilite",
  "/synchronisation-bancaire",
  "/gestion-tva",
  "/tarifs",
  "/solutions",
  "/faq",
  "/blog",
  "/contact",
  "/mentions-legales",
  "/cgu-cgv",
  "/confidentialite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url.replace(/\/$/, "");
  return [
    ...staticPaths.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: "monthly" as const,
      priority: path === "" ? 1 : 0.7,
    })),
    ...solutions.map((solution) => ({
      url: `${base}/solutions/${solution.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...blogPosts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: post.publishedAt,
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
