"use client";

import type { Faq } from "@/config/marketing";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <Accordion type="single" collapsible className="rounded-2xl border bg-card px-6 shadow-card">
      {items.map((item) => (
        <AccordionItem key={item.question} value={item.question}>
          <AccordionTrigger>{item.question}</AccordionTrigger>
          <AccordionContent>{item.answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
