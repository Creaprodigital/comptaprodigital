import { z } from "zod";

export const ticketSchema = z.object({
  subject: z.string().trim().min(4, "Indiquez l'objet de votre demande").max(191),
  message: z.string().trim().min(10, "Décrivez votre demande (10 caractères au moins)").max(10_000),
  companyId: z.union([z.string().max(40), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
});
export const ticketReplySchema = z.object({ body: z.string().trim().min(2, "Le message est vide").max(10_000) });
