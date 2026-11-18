import { z } from "zod";
import { authRoute } from "@/server/http/api";
import { csvResponse } from "@/server/http/csv";
import { authorizeCompany } from "@/server/rbac/service";
import { purchaseRegister, purchaseRegisterCsv, receiptsBook, receiptsBookCsv } from "@/server/modules/accounting/cash-book";

const querySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), book: z.enum(["receipts", "purchases"]).default("receipts"), format: z.enum(["json", "csv"]).optional() });

/** Livre des recettes et registre des achats (micro-entreprises). */
export const GET = authRoute<{ companyId: string }, undefined, typeof querySchema>({ query: querySchema }, async ({ auth, params, query }) => {
  const access = await authorizeCompany(auth.user.id, params.companyId, query.format === "csv" ? "exports:run" : "accounting:read");
  if (query.book === "purchases") return query.format === "csv" ? csvResponse(`registre-des-achats-${query.year}.csv`, await purchaseRegisterCsv(access, query.year)) : purchaseRegister(access, query.year);
  return query.format === "csv" ? csvResponse(`livre-des-recettes-${query.year}.csv`, await receiptsBookCsv(access, query.year)) : receiptsBook(access, query.year);
});
