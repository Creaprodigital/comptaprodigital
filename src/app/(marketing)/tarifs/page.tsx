import type { Metadata } from "next";
import { faqs } from "@/config/marketing";
import { FaqList } from "@/components/marketing/faq-list";
import { Pricing } from "@/components/marketing/pricing";
import { Container, CtaBanner, PageHero, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Tarifs",
  description: "Comparez les formules Starter, Pro et Business de ComptaPro Digital. Essai gratuit, sans carte bancaire.",
  alternates: { canonical: "/tarifs" },
};

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Tarifs"
        title="Des formules claires, sans frais cachés"
        description="Choisissez la formule adaptée à votre activité. Vous pouvez en changer ou résilier à tout moment."
      />
      <Section>
        <Container>
          <Pricing showComparison />
        </Container>
      </Section>
      <Section className="border-t bg-card">
        <Container className="max-w-3xl">
          <SectionHeading eyebrow="Abonnement" title="Questions sur les tarifs" />
          <div className="mt-10">
            <FaqList items={faqs.filter((faq) => faq.category === "Abonnement" || faq.category === "Produit")} />
          </div>
        </Container>
      </Section>
      <CtaBanner />
    </>
  );
}
