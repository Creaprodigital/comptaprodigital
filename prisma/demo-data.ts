import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { hashPassword } from "../src/server/auth/password";
import { addDays, addMonths, fromIsoDate, startOfMonth, todayInParis, type IsoDate } from "../src/lib/dates";
import { fiscalYearBounds } from "../src/server/modules/companies/fiscal-year";

/**
 * Jeu de démonstration : un compte et une entreprise fictifs avec douze mois
 * d'activité. Ces données n'existent que dans cette entreprise de démonstration ;
 * les entreprises des véritables clients ne reçoivent jamais de données d'exemple.
 */

export const DEMO_EMAIL = "demo@comptaprodigital.fr";

/** Générateur pseudo-aléatoire déterministe : le jeu de données est reproductible. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fingerprint(date: IsoDate, amount: string, label: string): string {
  return createHash("sha256").update(`${date}|${amount}|${label.toLowerCase()}`).digest("hex");
}

const CUSTOMERS = [
  { name: "Maison Verdier", city: "Lyon", postalCode: "69002", email: "compta@maison-verdier.example" },
  { name: "Studio Oréade", city: "Nantes", postalCode: "44000", email: "admin@studio-oreade.example" },
  { name: "Cabinet Halvard & Associés", city: "Paris", postalCode: "75008", email: "facturation@halvard.example" },
  { name: "Les Jardins de Solène", city: "Bordeaux", postalCode: "33000", email: "contact@jardins-solene.example" },
  { name: "Brasserie du Quai Neuf", city: "Lille", postalCode: "59800", email: "gestion@quai-neuf.example" },
];

const SERVICES = [
  { name: "Conception d'identité visuelle", unit: "forfait", price: "2400.00" },
  { name: "Développement de site vitrine", unit: "forfait", price: "3800.00" },
  { name: "Maintenance mensuelle", unit: "mois", price: "320.00" },
  { name: "Atelier de formation", unit: "jour", price: "950.00" },
  { name: "Conseil et accompagnement", unit: "heure", price: "110.00" },
];

const RECURRING_PURCHASES = [
  { label: "Loyer des bureaux", category: "Loyer et charges locatives", amount: "1150.00", vatRate: "20", supplier: "Foncière des Terreaux" },
  { label: "Abonnements logiciels", category: "Logiciels et abonnements", amount: "189.00", vatRate: "20", supplier: "Suite Créative SAS" },
  { label: "Forfait fibre et mobiles", category: "Télécom et internet", amount: "96.00", vatRate: "20", supplier: "Opérateur Télécom" },
  { label: "Assurance responsabilité civile", category: "Assurances", amount: "74.00", vatRate: "0", supplier: "Mutuelle des Indépendants" },
];

export async function seedDemoData(prisma: PrismaClient, password: string): Promise<{ created: boolean }> {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) return { created: false };

  const today = todayInParis();
  const random = mulberry32(20261113);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];

  const [ownerRole, plan, categories] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: "OWNER" } }),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "BUSINESS" } }),
    prisma.transactionCategory.findMany({ where: { companyId: null } }),
  ]);
  const categoryId = (name: string) => categories.find((c) => c.name === name)!.id;

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(password),
      firstName: "Camille",
      lastName: "Démo",
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      subscription: { create: { planId: plan.id, status: "TRIALING", trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } },
    },
  });

  const fiscalYear = fiscalYearBounds(1, today);
  const company = await prisma.company.create({
    data: {
      name: "Atelier Lumen (démonstration)",
      legalForm: "SAS",
      taxRegime: "IS_REEL_SIMPLIFIE",
      vatRegime: "REEL_NORMAL_MENSUEL",
      vatExigibility: "ENCAISSEMENTS",
      accountingMode: "DOUBLE_ENTRY",
      addressLine1: "12 rue des Lumières",
      postalCode: "69001",
      city: "Lyon",
      email: DEMO_EMAIL,
      createdById: user.id,
      members: { create: { userId: user.id, roleId: ownerRole.id } },
      fiscalYears: {
        create: [
          {
            label: fiscalYear.label,
            startDate: fromIsoDate(fiscalYear.startDate),
            endDate: fromIsoDate(fiscalYear.endDate),
          },
          {
            label: `Exercice ${Number(fiscalYear.startDate.slice(0, 4)) - 1}`,
            startDate: fromIsoDate(addMonths(fiscalYear.startDate, -12)),
            endDate: fromIsoDate(addDays(fiscalYear.startDate, -1)),
          },
        ],
      },
    },
  });
  const companyId = company.id;

  await prisma.customer.createMany({
    data: CUSTOMERS.map((c) => ({ ...c, companyId, addressLine1: "1 place du Marché", paymentTermDays: 30 })),
  });
  const customers = await prisma.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  await prisma.product.createMany({
    data: SERVICES.map((s) => ({ companyId, name: s.name, unit: s.unit, unitPriceExclTax: s.price, vatRate: "20.00", accountNumber: "706000" })),
  });
  await prisma.supplier.createMany({
    data: [...new Set(RECURRING_PURCHASES.map((p) => p.supplier))].map((name) => ({ companyId, name })),
  });
  const suppliers = await prisma.supplier.findMany({ where: { companyId } });

  const account = await prisma.bankAccount.create({
    data: {
      companyId,
      name: "Compte courant professionnel",
      bankName: "Banque de démonstration",
      ibanLast4: "0142",
      openingBalance: "14500.00",
      openingBalanceDate: fromIsoDate(startOfMonth(addMonths(today, -11))),
      accountNumber: "512000",
    },
  });

  const sequences = new Map<number, number>();
  const nextNumber = (date: IsoDate) => {
    const year = Number(date.slice(0, 4));
    const next = (sequences.get(year) ?? 0) + 1;
    sequences.set(year, next);
    return `F-${year}-${String(next).padStart(4, "0")}`;
  };

  type Tx = {
    date: IsoDate;
    label: string;
    amount: string;
    categoryId: string | null;
    vatAmount?: string;
    purchaseId?: string;
    paymentInvoiceId?: string;
    status: "TO_REVIEW" | "CATEGORIZED" | "RECONCILED";
  };
  const transactions: Tx[] = [];

  for (let offset = 11; offset >= 0; offset--) {
    const monthStart = startOfMonth(addMonths(today, -offset));

    // --- Factures de vente (chronologie respectée pour la numérotation) -----
    const invoiceCount = 3 + Math.floor(random() * 3);
    const days = Array.from({ length: invoiceCount }, () => 1 + Math.floor(random() * 26)).sort((a, b) => a - b);
    for (const day of days) {
      const issueDate = addDays(monthStart, day);
      if (issueDate > today) continue;
      const customer = pick(customers);
      const service = pick(SERVICES);
      const quantity = service.unit === "heure" ? 4 + Math.floor(random() * 20) : service.unit === "jour" ? 1 + Math.floor(random() * 3) : 1;
      const totalExclTax = new Decimal(service.price).times(quantity).toDecimalPlaces(2);
      const totalVat = totalExclTax.times(0.2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const totalInclTax = totalExclTax.plus(totalVat);
      const dueDate = addDays(issueDate, 30);
      const paidDate = addDays(issueDate, 12 + Math.floor(random() * 30));
      const roll = random();
      // Factures anciennes : presque toutes réglées ; récentes : en attente.
      const isPaid = paidDate <= today && (dueDate < addDays(today, -45) ? roll > 0.04 : roll > 0.25);
      const isPartial = !isPaid && dueDate < today && roll > 0.6;
      const amountPaid = isPaid ? totalInclTax : isPartial ? totalInclTax.dividedBy(2).toDecimalPlaces(2) : new Decimal(0);

      const invoice = await prisma.invoice.create({
        data: {
          companyId,
          customerId: customer.id,
          type: "INVOICE",
          status: isPaid ? "PAID" : isPartial ? "PARTIALLY_PAID" : "SENT",
          number: nextNumber(issueDate),
          issueDate: fromIsoDate(issueDate),
          dueDate: fromIsoDate(dueDate),
          subject: service.name,
          operationCategory: "SERVICES",
          vatExigibility: "ENCAISSEMENTS",
          totalExclTax: totalExclTax.toFixed(2),
          totalVat: totalVat.toFixed(2),
          totalInclTax: totalInclTax.toFixed(2),
          amountPaid: amountPaid.toFixed(2),
          issuedAt: fromIsoDate(issueDate),
          sentAt: fromIsoDate(issueDate),
          paidAt: isPaid ? fromIsoDate(paidDate) : null,
          createdById: user.id,
          items: {
            create: {
              position: 1,
              description: service.name,
              quantity: String(quantity),
              unit: service.unit,
              unitPriceExclTax: service.price,
              vatRate: "20.00",
              totalExclTax: totalExclTax.toFixed(2),
              totalVat: totalVat.toFixed(2),
              totalInclTax: totalInclTax.toFixed(2),
            },
          },
        },
      });
      if (amountPaid.greaterThan(0)) {
        transactions.push({
          date: isPaid ? paidDate : addDays(dueDate, -3),
          label: `VIR ${customer.name.toUpperCase()} ${invoice.number}`,
          amount: amountPaid.toFixed(2),
          categoryId: categoryId("Ventes et prestations"),
          paymentInvoiceId: invoice.id,
          status: "RECONCILED",
        });
      }
    }

    // --- Achats récurrents ---------------------------------------------------
    for (const [index, template] of RECURRING_PURCHASES.entries()) {
      const issueDate = addDays(monthStart, 2 + index * 3);
      if (issueDate > today) continue;
      const totalExclTax = new Decimal(template.amount);
      const totalVat = totalExclTax.times(template.vatRate).dividedBy(100).toDecimalPlaces(2);
      const totalInclTax = totalExclTax.plus(totalVat);
      const paidDate = addDays(issueDate, 5);
      const paid = paidDate <= today;
      const purchase = await prisma.purchase.create({
        data: {
          companyId,
          supplierId: suppliers.find((s) => s.name === template.supplier)!.id,
          label: template.label,
          issueDate: fromIsoDate(issueDate),
          dueDate: fromIsoDate(addDays(issueDate, 15)),
          status: paid ? "PAID" : "TO_PAY",
          categoryId: categoryId(template.category),
          totalExclTax: totalExclTax.toFixed(2),
          totalVat: totalVat.toFixed(2),
          totalInclTax: totalInclTax.toFixed(2),
          amountPaid: paid ? totalInclTax.toFixed(2) : "0.00",
          paidAt: paid ? fromIsoDate(paidDate) : null,
          createdById: user.id,
        },
      });
      if (paid) {
        transactions.push({
          date: paidDate,
          label: `PRLV ${template.supplier.toUpperCase()}`,
          amount: totalInclTax.negated().toFixed(2),
          categoryId: categoryId(template.category),
          purchaseId: purchase.id,
          status: "RECONCILED",
        });
      }
    }

    // --- Décaissements directs (sans facture fournisseur saisie) -------------
    const direct: Array<{ day: number; label: string; amount: number; category: string | null; vatRate: number }> = [
      { day: 4, label: "FRAIS TENUE DE COMPTE", amount: 18.5, category: "Frais bancaires", vatRate: 0 },
      { day: 14, label: "CB SNCF CONNECT", amount: 60 + Math.floor(random() * 140), category: "Déplacements et missions", vatRate: 10 },
      { day: 19, label: "CB RESTAURANT LE COMPTOIR", amount: 35 + Math.floor(random() * 60), category: "Repas et réceptions", vatRate: 10 },
      { day: 27, label: "VIR SALAIRE", amount: 2350, category: "Salaires", vatRate: 0 },
    ];
    if (offset <= 1) {
      direct.push({ day: 9, label: "CB PAPETERIE CENTRALE", amount: 84.9, category: null, vatRate: 0 });
      direct.push({ day: 21, label: "PRLV SEPA 8842917", amount: 129, category: null, vatRate: 0 });
    }
    for (const item of direct) {
      const date = addDays(monthStart, item.day);
      if (date > today) continue;
      const amount = new Decimal(item.amount).toDecimalPlaces(2);
      const vat = item.vatRate ? amount.minus(amount.dividedBy(new Decimal(1).plus(new Decimal(item.vatRate).dividedBy(100)))).toDecimalPlaces(2) : null;
      transactions.push({
        date,
        label: item.label,
        amount: amount.negated().toFixed(2),
        categoryId: item.category ? categoryId(item.category) : null,
        vatAmount: vat?.toFixed(2),
        status: item.category ? "CATEGORIZED" : "TO_REVIEW",
      });
    }
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));
  for (const tx of transactions) {
    const created = await prisma.bankTransaction.create({
      data: {
        companyId,
        bankAccountId: account.id,
        date: fromIsoDate(tx.date),
        label: tx.label,
        amount: tx.amount,
        status: tx.status,
        categoryId: tx.categoryId,
        vatAmount: tx.vatAmount,
        purchaseId: tx.purchaseId,
        fingerprint: fingerprint(tx.date, tx.amount, tx.label),
        reconciledAt: tx.status === "RECONCILED" ? fromIsoDate(tx.date) : null,
      },
    });
    if (tx.paymentInvoiceId) {
      await prisma.payment.create({
        data: {
          companyId,
          invoiceId: tx.paymentInvoiceId,
          amount: tx.amount,
          paidAt: fromIsoDate(tx.date),
          method: "TRANSFER",
          bankTransactionId: created.id,
          createdById: user.id,
        },
      });
    }
  }

  for (const [year, lastNumber] of sequences) {
    await prisma.numberSequence.create({ data: { companyId, type: "INVOICE", year, lastNumber } });
  }
  await prisma.notification.create({
    data: {
      userId: user.id,
      companyId,
      type: "welcome",
      title: "Bienvenue dans l'espace de démonstration",
      body: "Cette entreprise fictive contient douze mois d'activité pour explorer le tableau de bord.",
      link: "/app/tableau-de-bord",
    },
  });

  return { created: true };
}
