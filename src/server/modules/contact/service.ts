import { supportReference } from "@/server/modules/support/service";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import type { ContactInput } from "@/lib/schemas/contact";

function ticketReference(): string {
  return supportReference().replace("SP-", "CT-");
}

/**
 * Enregistre un message du formulaire de contact comme ticket de support,
 * prévient l'équipe (si CONTACT_EMAIL est configuré) et accuse réception.
 */
export async function submitContactMessage(input: ContactInput, userId?: string): Promise<{ reference: string }> {
  // Champ piège rempli : on répond comme si tout allait bien, sans rien enregistrer.
  if (input.website) return { reference: ticketReference() };

  const reference = ticketReference();
  await prisma.supportTicket.create({
    data: {
      reference,
      userId: userId ?? null,
      source: "CONTACT_FORM",
      contactName: input.name,
      contactEmail: input.email,
      subject: input.subject,
      messages: { create: { body: input.message, authorId: userId ?? null } },
    },
  });

  const teamAddress = env().CONTACT_EMAIL;
  const deliveries = [sendMail(mailTemplates.contactAcknowledgement(input.email, input.name, reference))];
  if (teamAddress) {
    deliveries.push(sendMail(mailTemplates.contactNotification(teamAddress, { ...input, reference })));
  }
  // Le ticket est enregistré : un échec d'envoi d'e-mail ne doit pas faire perdre la demande.
  const results = await Promise.allSettled(deliveries);
  for (const result of results) {
    if (result.status === "rejected") console.error("[contact] échec d'envoi d'e-mail", result.reason);
  }
  return { reference };
}
