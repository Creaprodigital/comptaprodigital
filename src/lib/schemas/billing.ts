import { z } from "zod";

export const checkoutSchema = z.object({ plan: z.string().trim().min(1).max(30), interval: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY") });
export const cancelSchema = z.object({ cancel: z.boolean() });
export const completeCheckoutSchema = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/, "Session invalide").max(255) });
