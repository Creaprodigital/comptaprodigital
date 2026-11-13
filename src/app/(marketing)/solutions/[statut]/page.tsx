import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { solutions } from "@/config/marketing";
import { Button } from "@/components/ui/button";
import { CheckList, Container, CtaBanner, Notice, PageHero, Section } from "@/components/marketing/sections";

type Props = { params: Promise<{ statut: string }> };

const PLAN_NAMES = { STARTER: "Starter", PRO: "Pro", BUSINESS: "Business" } as const;

// Toutes les valeurs du paramètre sont prérendues : la page peut bloquer sans coquille de chargement.
export const instant = false;

export function generateStaticParams() {
  return solutions.map((solution) => ({ statut: solution.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { statut } = await params;
  const solution = solutions.find((s) => s.slug === statut);
  if (!solution) return {};
  return {
    title: `Comptabilité et facturation — ${solution.name}`,
    description: solution.summary,
    alternates: { canonical: `/solutions/${solution.slug}` },
  };
}

export default async function SolutionPage({ params }: Props) {
  const { statut } = await params;
  const solution = solutions.find((s) => s.slug === statut);
  if (!solution) notFound();

  return (
    <>
      <PageHero eyebrow={solution.audience} title={solution.headline} description={solution.summary}>
        <Button asChild size="lg" variant="success">
          <Link href={`/inscription?plan=${solution.recommendedPlan.toLowerCase()}`}>Essayer gratuitement</Link>
        </Button>
      </PageHero>

      <Section>
        <Container className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border bg-card p-7 shadow-card">
            <h2 className="text-xl font-bold">Vos enjeux</h2>
            <CheckList items={solution.needs} className="mt-5" />
          </div>
          <div className="rounded-2xl border bg-card p-7 shadow-card">
            <h2 className="text-xl font-bold">Ce que la plateforme vous apporte</h2>
            <CheckList items={solution.features} className="mt-5" />
          </div>
        </Container>
        <Container className="mt-8 grid gap-6 lg:grid-cols-2">
          <Notice title="À noter">{solution.note}</Notice>
          <Notice title={`Formule conseillée : ${PLAN_NAMES[solution.recommendedPlan]}`}>
            Elle couvre les besoins habituels de ce statut. Vous pouvez comparer toutes les formules sur la page{" "}
            <Link href="/tarifs" className="font-semibold text-primary underline-offset-4 hover:underline">
              Tarifs
            </Link>{" "}
            et en changer à tout moment.
          </Notice>
        </Container>
      </Section>

      <CtaBanner />
    </>
  );
}
