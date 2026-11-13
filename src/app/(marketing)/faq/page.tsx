import type { Metadata } from "next";
import { faqs, type Faq } from "@/config/marketing";
import { FaqList } from "@/components/marketing/faq-list";
import { Container, CtaBanner, PageHero, Section } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Questions fréquentes",
  description: "Réponses aux questions les plus fréquentes sur ComptaPro Digital : produit, comptabilité, abonnement, sécurité et données.",
  alternates: { canonical: "/faq" },
};

const categories: Faq["category"][] = ["Produit", "Comptabilité et fiscalité", "Abonnement", "Sécurité et données"];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }} />
      <PageHero
        eyebrow="FAQ"
        title="Questions fréquentes"
        description="Tout ce qu'il faut savoir avant de commencer. Si votre question n'y figure pas, écrivez-nous."
      />
      <Section>
        <Container className="grid max-w-3xl gap-12">
          {categories.map((category) => (
            <div key={category}>
              <h2 className="text-2xl font-bold">{category}</h2>
              <div className="mt-5">
                <FaqList items={faqs.filter((faq) => faq.category === category)} />
              </div>
            </div>
          ))}
        </Container>
      </Section>
      <CtaBanner title="Une autre question ?" description="Notre équipe vous répond par e-mail. Vous pouvez aussi tester la plateforme gratuitement." />
    </>
  );
}
