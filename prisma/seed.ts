import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { passwordSchema } from "../src/lib/schemas/auth";
import { seedReferenceData } from "./reference-data";
import { DEMO_EMAIL, seedDemoData } from "./demo-data";

/**
 * npm run db:seed            → données de référence uniquement (production)
 * SEED_DEMO=true …           → ajoute le compte et l'entreprise de démonstration
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD → crée le super administrateur
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    await seedReferenceData(prisma);
    console.log("✔ Données de référence (rôles, permissions, formules, TVA, catégories)");

    const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      const check = passwordSchema.safeParse(adminPassword);
      if (!check.success) throw new Error(`SEED_ADMIN_PASSWORD : ${check.error.issues[0].message}`);
      const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
      } else {
        await prisma.user.create({
          data: {
            email: adminEmail,
            passwordHash: await hashPassword(adminPassword),
            firstName: "Super",
            lastName: "Admin",
            isSuperAdmin: true,
            emailVerifiedAt: new Date(),
            termsAcceptedAt: new Date(),
          },
        });
      }
      console.log(`✔ Super administrateur : ${adminEmail}`);
    }

    if (process.env.SEED_DEMO === "true") {
      if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO_FORCE !== "true") {
        throw new Error("SEED_DEMO est refusé en production (définir SEED_DEMO_FORCE=true pour une instance de démonstration).");
      }
      const password = process.env.SEED_DEMO_PASSWORD ?? "Demo-ComptaPro-2026!";
      const { created } = await seedDemoData(prisma, password);
      console.log(
        created
          ? `✔ Démonstration : ${DEMO_EMAIL} / ${process.env.SEED_DEMO_PASSWORD ? "(mot de passe fourni)" : password}`
          : "• Démonstration déjà présente",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
