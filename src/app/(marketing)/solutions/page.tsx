import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { solutions } from "@/config/marketing";
import { Container, CtaBanner, PageHero, Section } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Solutions par statut juridique",
  description:
    "Micro-entrepreneur, entreprise individuelle, EURL, SARL, SASU ou SAS : une gestion adaptée aux obligations de chaque statut.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="Une gestion adaptée à votre statut juridique"
        description="Vos obligations ne sont pas les mêmes en micro-entreprise et en société. La plateforme ajuste ses fonctionnalités à votre forme juridique et à votre régime fiscal."
      />
      <Section>
        <Container>
          <ul className="grid gap-6 md:grid-cols-2">
            {solutions.map((solution) => (
              <li key={solution.slug}>
                <Link
                  href={`/solutions/${solution.slug}`}
                  className="group flex h-full flex-col rounded-2xl border bg-card p-7 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
                >
                  <p className="text-sm font-medium text-primary">{solution.audience}</p>
                  <h2 className="mt-2 text-2xl font-bold">{solution.name}</h2>
                  <p className="mt-3 flex-1 text-[15px] leading-relaxed text-muted-foreground">{solution.summary}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    Voir la solution <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
      <CtaBanner />
    </>
  );
}
