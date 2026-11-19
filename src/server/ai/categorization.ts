import Decimal from "decimal.js";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { CompanyAccess } from "@/server/rbac/service";
import { listCategories } from "@/server/modules/bank/categories";
import { updateTransaction } from "@/server/modules/bank/transactions";
import { toIsoDate } from "@/lib/dates";
import { FALLBACK_BETA } from "./client";
import { assertAiUsable, runAi } from "./service";

/**
 * Suggestions de catégorie pour les opérations bancaires non catégorisées.
 * Chaque suggestion est enregistrée « en attente » : rien n'est modifié tant que
 * l'utilisateur ne l'accepte pas. L'acceptation passe par le même service que la
 * catégorisation manuelle (contrôles, historique, écritures au brouillard).
 */

type Meta = { ip?: string | null; userAgent?: string | null };

const KIND = "TRANSACTION_CATEGORY";
const BATCH = 40;
const VAT_RATES = ["20.00", "10.00", "5.50", "2.10", "0.00"];
const CONFIDENCE = { low: "0.300", medium: "0.600", high: "0.900" } as const;

const SuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      transactionId: z.string(),
      categoryId: z.string().nullable(),
      vatRate: z.string().nullable().describe("Taux de TVA probable en pourcentage (20.00, 10.00, 5.50, 2.10, 0.00) ou null si inconnu"),
      confidence: z.enum(["low", "medium", "high"]),
      reason: z.string().describe("Justification courte en français"),
    }),
  ),
});

const SYSTEM_PROMPT = `Tu aides une entreprise française à catégoriser ses opérations bancaires. Pour chaque opération, propose la catégorie la plus adaptée parmi celles fournies, ou null si aucune ne convient ou si le libellé est trop ambigu.

Règles :
- Utilise uniquement les identifiants de catégories fournis ; une dépense (montant négatif) va dans une catégorie de dépense, une recette (montant positif) dans une catégorie de recette.
- Appuie-toi sur les exemples de catégorisation déjà faits par l'entreprise : ils priment sur tes habitudes.
- vatRate : le taux de TVA français habituellement applicable à ce type de dépense, ou null pour les opérations sans TVA (salaires, cotisations, impôts, virements internes, frais bancaires exonérés) ou si tu n'as pas d'indice.
- confidence « high » seulement si le libellé désigne sans ambiguïté le fournisseur ou la nature de l'opération.
- reason : une phrase courte en français.
Réponds pour chaque opération transmise.`;

export type CategorySuggestionView = {
  id: string;
  transaction: { id: string; date: string; label: string; amount: string };
  category: { id: string; name: string } | null;
  vatRate: string | null;
  confidence: "low" | "medium" | "high";
  reason: string;
  createdAt: string;
};

type Payload = { categoryId: string | null; vatRate: string | null; reason: string; confidence: "low" | "medium" | "high" };

/** Demande des suggestions pour les opérations non catégorisées (par lots de 40). */
export async function suggestCategories(access: CompanyAccess, userId: string, options: { transactionIds?: string[] } = {}): Promise<{ requested: number; suggested: number }> {
  const companyId = access.company.id;
  await assertAiUsable(access);
  const pending = await prisma.aiSuggestion.findMany({ where: { companyId, kind: KIND, status: "PENDING" }, select: { entityId: true } });
  const exclude = new Set(pending.map((p) => p.entityId));
  const candidates = await access.db.bankTransaction.findMany({
    where: { categoryId: null, ...(options.transactionIds ? { id: { in: options.transactionIds } } : {}) },
    select: { id: true, date: true, label: true, amount: true },
    orderBy: { date: "desc" },
    take: BATCH * 2,
  });
  const batch = candidates.filter((t) => !exclude.has(t.id)).slice(0, BATCH);
  if (batch.length === 0) return { requested: 0, suggested: 0 };

  const [categories, examples] = await Promise.all([
    listCategories(companyId),
    access.db.bankTransaction.findMany({ where: { categoryId: { not: null } }, select: { label: true, amount: true, category: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 60 }),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const batchIds = new Set(batch.map((t) => t.id));

  const suggestions = await runAi(access, userId, "CATEGORIZATION", async (client, model) => {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(SuggestionsSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            "Catégories (identifiant | nom | nature) :",
            ...categories.map((c) => `${c.id} | ${c.name} | ${c.kind === "EXPENSE" ? "dépense" : c.kind === "INCOME" ? "recette" : "autre"}`),
            "",
            "Exemples déjà catégorisés par l'entreprise (libellé | montant | catégorie) :",
            ...(examples.length ? examples.map((e) => `${e.label} | ${new Decimal(e.amount).toFixed(2)} | ${e.category?.name}`) : ["(aucun)"]),
            "",
            "Opérations à catégoriser (identifiant | date | libellé | montant en euros) :",
            ...batch.map((t) => `${t.id} | ${toIsoDate(t.date)} | ${t.label} | ${new Decimal(t.amount).toFixed(2)}`),
          ].join("\n"),
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return { result: [], usage: [response.usage], refused: response.stop_reason === "refusal" };
    return { result: response.parsed_output.suggestions, usage: [response.usage] };
  });

  // Contrôles : opération demandée, catégorie existante et de même sens que le montant.
  const rows = suggestions.flatMap((s) => {
    if (!batchIds.has(s.transactionId)) return [];
    const transaction = batch.find((t) => t.id === s.transactionId)!;
    const category = s.categoryId ? byId.get(s.categoryId) : undefined;
    if (!category) return [];
    const outflow = new Decimal(transaction.amount).isNegative();
    if ((outflow && category.kind === "INCOME") || (!outflow && category.kind === "EXPENSE")) return [];
    const vatRate = s.vatRate && VAT_RATES.includes(new Decimal(s.vatRate.replace(",", ".")).toFixed(2)) ? new Decimal(s.vatRate.replace(",", ".")).toFixed(2) : null;
    const payload: Payload = { categoryId: category.id, vatRate, reason: s.reason.slice(0, 300), confidence: s.confidence };
    return [{ companyId, kind: KIND, entityType: "BankTransaction", entityId: transaction.id, payload, confidence: CONFIDENCE[s.confidence], createdById: userId }];
  });
  const unique = [...new Map(rows.map((r) => [r.entityId, r])).values()];
  if (unique.length) await prisma.aiSuggestion.createMany({ data: unique });
  return { requested: batch.length, suggested: unique.length };
}

/** Suggestions en attente ; celles devenues sans objet (opération catégorisée ou supprimée) sont écartées. */
export async function listCategorySuggestions(access: CompanyAccess): Promise<CategorySuggestionView[]> {
  const companyId = access.company.id;
  const rows = await prisma.aiSuggestion.findMany({ where: { companyId, kind: KIND, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 200 });
  if (rows.length === 0) return [];
  const [transactions, categories] = await Promise.all([
    access.db.bankTransaction.findMany({ where: { id: { in: rows.map((r) => r.entityId) } }, select: { id: true, date: true, label: true, amount: true, categoryId: true } }),
    listCategories(companyId),
  ]);
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const obsolete = rows.filter((r) => !txById.get(r.entityId) || txById.get(r.entityId)!.categoryId !== null).map((r) => r.id);
  if (obsolete.length) await prisma.aiSuggestion.updateMany({ where: { id: { in: obsolete } }, data: { status: "OBSOLETE" } });
  return rows
    .filter((r) => !obsolete.includes(r.id))
    .map((r) => {
      const p = r.payload as Payload;
      const t = txById.get(r.entityId)!;
      const category = categories.find((c) => c.id === p.categoryId);
      return {
        id: r.id,
        transaction: { id: t.id, date: toIsoDate(t.date), label: t.label, amount: new Decimal(t.amount).toFixed(2) },
        category: category ? { id: category.id, name: category.name } : null,
        vatRate: p.vatRate,
        confidence: p.confidence,
        reason: p.reason,
        createdAt: r.createdAt.toISOString(),
      };
    });
}

/**
 * Décision de l'utilisateur. L'acceptation applique la catégorie (éventuellement corrigée)
 * par le service de catégorisation habituel ; le refus est simplement enregistré.
 */
export async function decideSuggestions(
  access: CompanyAccess,
  userId: string,
  input: { ids: string[]; decision: "accept" | "reject"; categoryId?: string | null; vatRate?: string | null },
  meta: Meta = {},
): Promise<{ accepted: number; rejected: number }> {
  const companyId = access.company.id;
  const rows = await prisma.aiSuggestion.findMany({ where: { id: { in: [...new Set(input.ids)] }, companyId, kind: KIND, status: "PENDING" } });
  if (rows.length !== new Set(input.ids).size) throw errors.notFound("Certaines suggestions sont introuvables ou déjà traitées.");
  let accepted = 0;
  let rejected = 0;
  for (const row of rows) {
    if (input.decision === "reject") {
      await prisma.aiSuggestion.update({ where: { id: row.id }, data: { status: "REJECTED", reviewedById: userId, reviewedAt: new Date() } });
      rejected++;
      continue;
    }
    const p = row.payload as Payload;
    const categoryId = input.categoryId !== undefined ? input.categoryId : p.categoryId;
    const vatRate = input.vatRate !== undefined ? input.vatRate : p.vatRate;
    if (!categoryId) throw errors.validation([{ path: "categoryId", message: "Choisissez une catégorie" }]);
    await updateTransaction(access, userId, row.entityId, { categoryId, vatRate: vatRate ?? undefined }, meta);
    await prisma.aiSuggestion.update({ where: { id: row.id }, data: { status: "ACCEPTED", reviewedById: userId, reviewedAt: new Date() } });
    accepted++;
  }
  return { accepted, rejected };
}
