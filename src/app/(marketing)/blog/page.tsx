import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { blogPosts } from "@/config/blog";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Container, PageHero, Section } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Blog — gestion, facturation et TVA",
  description: "Conseils pratiques et décryptages pour les indépendants et dirigeants de petites entreprises : facturation, TVA, comptabilité.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <>
      <PageHero
        eyebrow="Blog"
        title="Comprendre pour mieux gérer"
        description="Des articles pratiques sur la facturation, la TVA et la gestion des petites entreprises."
      />
      <Section>
        <Container>
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {blogPosts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group flex h-full flex-col rounded-2xl border bg-card p-7 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
                >
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant="accent">{post.category}</Badge>
                    <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, "long")}</time>
                  </div>
                  <h2 className="mt-4 text-xl leading-snug font-bold text-balance">{post.title}</h2>
                  <p className="mt-3 flex-1 text-[15px] leading-relaxed text-muted-foreground">{post.description}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    Lire l'article · {post.readingMinutes} min
                    <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
