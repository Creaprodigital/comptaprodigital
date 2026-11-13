import { Container, PageHero, Section } from "@/components/marketing/sections";

export type LegalSection = { title: string; paragraphs?: string[]; list?: string[] };

/** Gabarit commun aux pages juridiques. */
export function LegalDocument({
  title,
  description,
  updatedAt,
  sections,
  children,
}: {
  title: string;
  description: string;
  updatedAt: string;
  sections: LegalSection[];
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHero eyebrow="Informations légales" title={title} description={description} />
      <Section>
        <Container className="max-w-3xl">
          <p className="text-sm text-muted-foreground">Dernière mise à jour : {updatedAt}</p>
          {children}
          <div className="mt-8 grid gap-10">
            {sections.map((section, index) => (
              <section key={section.title}>
                <h2 className="text-xl font-bold">
                  {index + 1}. {section.title}
                </h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph.slice(0, 48)} className="mt-3 text-[15px] leading-relaxed text-foreground/85">
                    {paragraph}
                  </p>
                ))}
                {section.list ? (
                  <ul className="mt-3 grid list-disc gap-1.5 pl-6 text-[15px] leading-relaxed text-foreground/85 marker:text-primary">
                    {section.list.map((item) => (
                      <li key={item.slice(0, 48)}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
