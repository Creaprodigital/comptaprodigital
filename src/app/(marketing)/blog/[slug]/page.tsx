import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { blogPosts, getBlogPost } from "@/config/blog";
import { siteConfig } from "@/config/site";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Container, CtaBanner, Notice } from "@/components/marketing/sections";

type Props = { params: Promise<{ slug: string }> };

// Toutes les valeurs du paramètre sont prérendues : la page peut bloquer sans coquille de chargement.
export const instant = false;

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.description, publishedTime: post.publishedAt },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    inLanguage: "fr-FR",
    author: { "@type": "Organization", name: siteConfig.name },
    publisher: { "@type": "Organization", name: siteConfig.name },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd).replace(/</g, "\\u003c") }} />
      <article>
        <header className="border-b bg-card">
          <Container className="max-w-3xl py-12 sm:py-16">
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeftIcon className="size-4" /> Tous les articles
            </Link>
            <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="accent">{post.category}</Badge>
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, "long")}</time>
              <span>· {post.readingMinutes} min de lecture</span>
            </div>
            <h1 className="mt-4 text-3xl leading-tight font-bold text-balance sm:text-4xl">{post.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{post.description}</p>
          </Container>
        </header>

        <Container className="max-w-3xl py-12 sm:py-16">
          <div className="grid gap-10">
            {post.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-2xl leading-snug font-bold">{section.heading}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="mt-4 text-[17px] leading-relaxed text-foreground/85">
                    {paragraph}
                  </p>
                ))}
                {section.list ? (
                  <ul className="mt-4 grid list-disc gap-2 pl-6 text-[17px] leading-relaxed text-foreground/85 marker:text-primary">
                    {section.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <Notice title="Pour aller plus loin" className="mt-12">
            <p>
              Cet article présente des informations générales et ne constitue pas un conseil fiscal ou juridique. La
              réglementation évolue : référez-vous aux sources officielles et à votre expert-comptable.
            </p>
            <ul className="mt-3 grid gap-1.5">
              {post.sources.map((source) => (
                <li key={source.label}>
                  <a href={source.url} rel="noopener noreferrer" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </Notice>
        </Container>
      </article>
      <CtaBanner />
    </>
  );
}
