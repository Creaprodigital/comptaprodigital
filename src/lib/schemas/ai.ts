import { z } from "zod";

export const aiToggleSchema = z.object({ enabled: z.boolean() });

export const assistantSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((m) => m.at(-1)?.role === "user", "La conversation doit se terminer par une question"),
});

export const suggestRequestSchema = z.object({ transactionIds: z.array(z.string().max(40)).max(200).optional() });

export const suggestionDecisionSchema = z.object({
  ids: z.array(z.string().max(40)).min(1, "Sélectionnez au moins une suggestion").max(200),
  decision: z.enum(["accept", "reject"]),
  categoryId: z.string().max(40).nullable().optional(),
  vatRate: z.enum(["20.00", "10.00", "5.50", "2.10", "0.00"]).nullable().optional(),
});
