/**
 * Mesures de performance sur un jeu de données volumineux (base dédiée, jamais la production) :
 *   PERF_DATABASE_URL=mysql://…/comptapro_perf npx tsx tests/perf/run.mts [--seed]
 * Volume : 1 entreprise, 20 000 opérations bancaires, 3 000 achats, 1 000 factures émises.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

const url = process.env.PERF_DATABASE_URL;
if (!url || !/_perf(\?|$)/.test(url)) throw new Error("PERF_DATABASE_URL doit désigner une base dont le nom se termine par _perf");
process.env.DATABASE_URL = url;

const { prisma } = await import("@/server/db");
const { seedReferenceData } = await import("../../prisma/reference-data");
const { createCompany } = await import("@/server/modules/companies/service");
const { authorizeCompany } = await import("@/server/rbac/service");
const { createBankAccount } = await import("@/server/modules/bank/accounts");
const { listCategories } = await import("@/server/modules/bank/categories");
const { listTransactions } = await import("@/server/modules/bank/transactions");
const { createCustomer } = await import("@/server/modules/customers/service");
const { createInvoiceDraft, issueInvoice } = await import("@/server/modules/invoicing/invoices");
const { listInvoices } = await import("@/server/modules/invoicing/invoices");
const { listPurchases } = await import("@/server/modules/purchases/service");
const { getDashboard } = await import("@/server/modules/dashboard/service");
const { runControls } = await import("@/server/modules/controls/service");
const { resyncAll } = await import("@/server/modules/accounting/sync");
const { trialBalance, generalLedger } = await import("@/server/modules/accounting/reports");
const { buildFec } = await import("@/server/modules/accounting/fec");
const { createCompanySchema } = await import("@/lib/schemas/company");
const { bankAccountSchema } = await import("@/lib/schemas/bank");
const { customerSchema, invoiceSchema } = await import("@/lib/schemas/invoicing");
const { addDays, todayInParis, fromIsoDate } = await import("@/lib/dates");
const { sha256Hex } = await import("@/server/security/crypto");
const { hashPassword } = await import("@/server/auth/password");

const today = todayInParis();
const year = today.slice(0, 4);

async function seed() {
  await seedReferenceData(prisma);
  const user = await prisma.user.create({ data: { email: `perf-${randomBytes(4).toString("hex")}@exemple.test`, passwordHash: await hashPassword("Perf-ComptaPro-2026!"), firstName: "Perf", lastName: "Test", emailVerifiedAt: new Date() } });
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "BUSINESS" } });
  await prisma.subscription.create({ data: { userId: user.id, planId: plan.id, status: "ACTIVE", billingInterval: "MONTHLY" } });
  const company = await createCompany(user.id, createCompanySchema.parse({ name: "Volume SAS", siren: "552100554", legalForm: "SAS", taxRegime: "IS_REEL_NORMAL", vatRegime: "REEL_NORMAL_MENSUEL", vatExigibility: "DEBITS", fiscalYearStartMonth: 1 }));
  const access = await authorizeCompany(user.id, company.id, "company:read");
  const categories = (await listCategories(company.id)).filter((c) => c.kind === "EXPENSE");
  const income = (await listCategories(company.id)).filter((c) => c.kind === "INCOME");
  const account = await createBankAccount(access, user.id, bankAccountSchema.parse({ name: "Compte principal", openingBalance: "50000", openingBalanceDate: `${Number(year) - 1}-12-31` }));
  const elapsedDays = Math.max(1, Math.floor((Date.parse(today) - Date.parse(`${year}-01-01`)) / 86400_000));
  const dayOfYear = (i: number) => addDays(`${year}-01-01`, i % Math.max(1, Math.floor((Date.parse(today) - Date.parse(`${year}-01-01`)) / 86400_000)));

  const labels = ["PRLV OPERATEUR", "CB PAPETERIE", "VIR CLIENT", "CB RESTAURANT", "PRLV ENERGIE", "VIR LOYER", "CB CARBURANT", "PRLV LOGICIEL"];
  const rows = Array.from({ length: 20_000 }, (_, i) => {
    const amount = i % 5 === 0 ? (100 + (i % 900)).toFixed(2) : (-(10 + (i % 400))).toFixed(2);
    const date = dayOfYear(i);
    const label = `${labels[i % labels.length]} ${i}`;
    return {
      id: `bt${randomBytes(11).toString("hex")}`, companyId: company.id, bankAccountId: account.id, date: fromIsoDate(date), label, amount,
      fingerprint: sha256Hex(`${date}|${amount}|${label}`), status: (i % 3 === 0 ? "TO_REVIEW" : "CATEGORIZED") as "TO_REVIEW" | "CATEGORIZED",
      categoryId: i % 3 === 0 ? null : amount.startsWith("-") ? categories[i % categories.length].id : income[0].id,
    };
  });
  for (let i = 0; i < rows.length; i += 2000) await prisma.bankTransaction.createMany({ data: rows.slice(i, i + 2000) });

  const suppliers = await Promise.all(Array.from({ length: 50 }, (_, i) => prisma.supplier.create({ data: { companyId: company.id, name: `Fournisseur ${i}` } })));
  const purchases = Array.from({ length: 3000 }, (_, i) => {
    const ht = (50 + (i % 500)).toFixed(2);
    const vat = (Number(ht) * 0.2).toFixed(2);
    return { companyId: company.id, supplierId: suppliers[i % 50].id, reference: `F-${i}`, label: `Achat ${i}`, issueDate: fromIsoDate(dayOfYear(i * 7)), status: "TO_PAY" as const, categoryId: categories[i % categories.length].id, totalExclTax: ht, totalVat: vat, totalInclTax: (Number(ht) + Number(vat)).toFixed(2) };
  });
  await prisma.purchase.createMany({ data: purchases });

  const customers = [];
  for (let i = 0; i < 100; i++) customers.push(await createCustomer(access, user.id, customerSchema.parse({ name: `Client ${i}` })));
  const started = Date.now();
  for (let i = 0; i < 1000; i++) {
    const draft = await createInvoiceDraft(access, user.id, invoiceSchema.parse({ customerId: customers[i % 100].id, issueDate: addDays(`${year}-01-01`, Math.floor((i * elapsedDays) / 1000)), items: [{ description: "Prestation", quantity: "1", unitPriceExclTax: (200 + (i % 800)).toFixed(2), discountRate: "0", vatRate: "20" }] }));
    await issueInvoice(access, user.id, draft.id);
  }
  console.log(`Création et émission de 1 000 factures : ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { userId: user.id, companyId: company.id };
}

async function time<T>(label: string, fn: () => Promise<T>, runs = 5) {
  const durations: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  console.log(`${label.padEnd(48)} médiane ${durations[Math.floor(runs / 2)].toFixed(0).padStart(6)} ms   max ${durations.at(-1)!.toFixed(0).padStart(6)} ms`);
}

const existing = await prisma.company.findFirst({ where: { name: "Volume SAS" }, select: { id: true, createdById: true } });
const ids = process.argv.includes("--seed") || !existing ? await seed() : { userId: existing.createdById!, companyId: existing.id };
const access = await authorizeCompany(ids.userId, ids.companyId, "company:read");
const company = access.company;

if (process.argv.includes("--from-scratch")) {
  // Première utilisation de la comptabilité : toutes les écritures sont à créer.
  await prisma.accountingEntry.deleteMany({ where: { companyId: company.id } });
}
let start = performance.now();
const sync = await resyncAll(company);
console.log(`Synchronisation comptable complète (${sync.changed} changement(s))`.padEnd(48), `${(performance.now() - start).toFixed(0)} ms`);
const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: company.id }, orderBy: { startDate: "desc" } });

await time("Opérations bancaires (page 1)", () => listTransactions(access, {}));
await time("Opérations bancaires (recherche « ENERGIE »)", () => listTransactions(access, { q: "ENERGIE" }));
await time("Opérations bancaires (à traiter)", () => listTransactions(access, { status: "TO_REVIEW" }));
await time("Factures (page 1)", () => listInvoices(access, {}));
await time("Achats (page 1)", () => listPurchases(access, {}));
await time("Tableau de bord (exercice)", () => getDashboard(company, { preset: "year" }));
await time("Contrôles automatiques", () => runControls(access));
await time("Balance générale", () => trialBalance(access, {}));
await time("Grand livre (compte 512)", () => generalLedger(access, { account: "512" } as never));
start = performance.now();
const fec = await buildFec(access, ids.userId, fy.id);
console.log(`${"Export FEC".padEnd(48)} ${(performance.now() - start).toFixed(0)} ms (${fec.lineCount} lignes)`);
await prisma.$disconnect();
