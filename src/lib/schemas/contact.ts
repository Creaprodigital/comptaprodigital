import { z } from "zod";
import { emailSchema } from "@/lib/schemas/auth";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Votre nom est requis").max(191).regex(/^[^<>]*$/, "Caractères non autorisés"),
  email: emailSchema,
  subject: z.string().trim().min(3, "L'objet est requis").max(191).regex(/^[^<>]*$/, "Caractères non autorisés"),
  message: z.string().trim().min(20, "Votre message doit contenir au moins 20 caractères").max(5000, "Message trop long"),
  consent: z.literal(true, "Votre accord est nécessaire pour traiter votre demande"),
  /** Champ piège anti-robots : doit rester vide. */
  website: z.string().max(0).optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;
