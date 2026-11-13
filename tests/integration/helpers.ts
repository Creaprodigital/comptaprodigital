import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { registerUser, verifyEmail, login } from "@/server/auth/auth-service";
import { validateSessionToken, type AuthContext } from "@/server/auth/session-store";
import { clearMemoryOutbox, getMemoryOutbox, type MailMessage } from "@/server/mail/mailer";
import { invalidatePermissionCache } from "@/server/rbac/service";
import { createCompany } from "@/server/modules/companies/service";
import type { z } from "zod";
import type { PlanKey } from "@/lib/schemas/auth";
import { createCompanySchema } from "@/lib/schemas/company";
import { seedReferenceData } from "../../prisma/reference-data";

export const PASSWORD = "Compta-Solide-2026!";

/** Vide toutes les tables de la base de test puis recharge les données de référence. */
export async function resetDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(`Refus de vider une base qui n'est pas une base de test : ${url.replace(/:[^:@/]+@/, ":***@")}`);
  }
  const tables = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const { name } of tables) {
    await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE ${Prisma.raw(`\`${name}\``)}`);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  await seedReferenceData(prisma);
  invalidatePermissionCache();
  clearMemoryOutbox();
}

export async function clearRateLimits(): Promise<void> {
  await prisma.rateLimitCounter.deleteMany();
}

export function lastMailTo(email: string): MailMessage {
  const mail = [...getMemoryOutbox()].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`Aucun e-mail envoyé à ${email}`);
  return mail;
}

export function mailsTo(email: string): MailMessage[] {
  return getMemoryOutbox().filter((m) => m.to === email);
}

/** Extrait le jeton d'un lien « ?token=… » ou « /invitation/… ». */
export function tokenFromMail(mail: MailMessage): string {
  const match = /token=([A-Za-z0-9_%-]+)/.exec(mail.text) ?? /\/invitation\/([A-Za-z0-9_%-]+)/.exec(mail.text);
  if (!match) throw new Error("Aucun jeton dans l'e-mail");
  return decodeURIComponent(match[1]);
}

let userCounter = 0;

/** Crée un compte par le parcours réel : inscription, e-mail de confirmation, vérification. */
export async function createVerifiedUser(options: { email?: string; plan?: PlanKey; firstName?: string } = {}) {
  const email = options.email ?? `utilisateur${++userCounter}@exemple.test`;
  await registerUser({
    firstName: options.firstName ?? "Ada",
    lastName: "Martin",
    email,
    password: PASSWORD,
    plan: options.plan ?? "PRO",
    acceptTerms: true,
  });
  await verifyEmail(tokenFromMail(lastMailTo(email)));
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

export async function loginAs(email: string): Promise<AuthContext> {
  const result = await login({ email, password: PASSWORD });
  if (result.status !== "authenticated") throw new Error("Connexion incomplète (MFA requis)");
  const auth = await validateSessionToken(result.token);
  if (!auth) throw new Error("Session invalide");
  return auth;
}

/** Crée une entreprise en passant par le même schéma de validation que l'API. */
export async function createTestCompany(userId: string, name: string, overrides: Partial<z.input<typeof createCompanySchema>> = {}) {
  return createCompany(
    userId,
    createCompanySchema.parse({
      name,
      legalForm: "SASU",
      taxRegime: "IS_REEL_SIMPLIFIE",
      vatRegime: "REEL_NORMAL_MENSUEL",
      vatExigibility: "ENCAISSEMENTS",
      fiscalYearStartMonth: 1,
      ...overrides,
    }),
  );
}

export async function addMember(companyId: string, userId: string, roleKey: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  return prisma.companyUser.create({ data: { companyId, userId, roleId: role.id } });
}

export { prisma };
