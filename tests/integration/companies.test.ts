import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeCompany } from "@/server/rbac/service";
import { createCompany, listUserCompanies, updateCompany } from "@/server/modules/companies/service";
import { createCompanySchema, updateCompanySchema } from "@/lib/schemas/company";
import { acceptInvitation, getInvitationPreview, inviteMember, listMembers, removeMember, revokeInvitation, updateMemberRole } from "@/server/modules/companies/members";
import { submitContactMessage } from "@/server/modules/contact/service";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { toIsoDate, todayInParis } from "@/lib/dates";
import { clearRateLimits, createTestCompany, createVerifiedUser, lastMailTo, loginAs, mailsTo, prisma, resetDatabase, tokenFromMail } from "./helpers";

beforeAll(resetDatabase);
beforeEach(clearRateLimits);

describe("création d'entreprise", () => {
  it("crée l'entreprise, son propriétaire et l'exercice en cours", async () => {
    const user = await createVerifiedUser({ email: "fondateur@exemple.test" });
    const company = await createCompany(
      user.id,
      createCompanySchema.parse({
        name: "Atelier Exemple",
        siren: "552100554",
        legalForm: "SAS",
        taxRegime: "IS_REEL_NORMAL",
        vatRegime: "REEL_NORMAL_MENSUEL",
        vatExigibility: "DEBITS",
        fiscalYearStartMonth: 7,
      }),
    );

    expect(company.accountingMode).toBe("DOUBLE_ENTRY");
    expect(company.vatNumber).toBe("FR96552100554"); // déduit du SIREN
    const access = await authorizeCompany(user.id, company.id, "company:delete");
    expect(access.roleKey).toBe("OWNER");

    const [fiscalYear] = await prisma.fiscalYear.findMany({ where: { companyId: company.id } });
    const today = todayInParis();
    expect(toIsoDate(fiscalYear.startDate).slice(5)).toBe("07-01");
    expect(toIsoDate(fiscalYear.startDate) <= today && today <= toIsoDate(fiscalYear.endDate)).toBe(true);
    expect(await prisma.auditLog.count({ where: { companyId: company.id, action: "company.create" } })).toBe(1);
  });

  it("tient un livre des recettes pour une micro-entreprise en franchise", async () => {
    const user = await createVerifiedUser({ email: "micro@exemple.test", plan: "STARTER" });
    const company = await createCompany(
      user.id,
      createCompanySchema.parse({ name: "Micro Exemple", siren: "732829320", legalForm: "MICRO_ENTREPRISE", taxRegime: "MICRO_BNC", vatRegime: "FRANCHISE" }),
    );
    expect(company.accountingMode).toBe("CASH_BOOK");
    expect(company.vatNumber).toBeNull(); // pas de numéro de TVA en franchise
  });

  it("plafonne le nombre d'entreprises selon la formule", async () => {
    const pro = await createVerifiedUser({ email: "pro@exemple.test", plan: "PRO" });
    await createTestCompany(pro.id, "Première");
    await expect(createTestCompany(pro.id, "Deuxième")).rejects.toMatchObject({ status: 403, code: "PLAN_LIMIT_REACHED" });

    const business = await createVerifiedUser({ email: "business@exemple.test", plan: "BUSINESS" });
    await createTestCompany(business.id, "Holding");
    await createTestCompany(business.id, "Filiale");
    expect((await listUserCompanies(business.id)).map((c) => c.name)).toEqual(["Holding", "Filiale"]);
  });

  it("applique la limite configurée en base (modifiable par l'administration)", async () => {
    const pro = await prisma.user.findUniqueOrThrow({ where: { email: "pro@exemple.test" } });
    await prisma.subscriptionPlan.update({ where: { key: "PRO" }, data: { limits: { maxCompanies: 2, maxMembers: 2, modules: [] } } });
    await expect(createTestCompany(pro.id, "Deuxième")).resolves.toBeDefined();
    await prisma.subscriptionPlan.update({ where: { key: "PRO" }, data: { limits: { maxCompanies: 1, maxMembers: 2, modules: [] } } });
  });

  it("trace les modifications des informations légales", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "fondateur@exemple.test" } });
    const [{ id }] = await listUserCompanies(user.id);
    const access = await authorizeCompany(user.id, id, "company:update");
    await updateCompany(
      access,
      user.id,
      updateCompanySchema.parse({ name: "Atelier Exemple Renommé", siren: "552100554", legalForm: "SAS", taxRegime: "IS_REEL_NORMAL", vatRegime: "REEL_SIMPLIFIE", vatExigibility: "DEBITS" }),
    );
    const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: id, action: "company.update" } });
    expect(log.metadata).toMatchObject({ changes: { name: { to: "Atelier Exemple Renommé" }, vatRegime: { from: "REEL_NORMAL_MENSUEL", to: "REEL_SIMPLIFIE" } } });
  });
});

describe("membres et invitations", () => {
  it("invite, puis rattache le destinataire avec le rôle prévu", async () => {
    const owner = await createVerifiedUser({ email: "dirigeante@exemple.test", plan: "BUSINESS", firstName: "Lina" });
    const company = await createTestCompany(owner.id, "Société Équipe");
    const ownerAuth = await loginAs(owner.email);
    const access = await authorizeCompany(owner.id, company.id, "members:manage");

    await inviteMember(access, ownerAuth.user, { email: "comptable@exemple.test", role: "EXTERNAL_ACCOUNTANT" });
    const mail = lastMailTo("comptable@exemple.test");
    expect(mail.subject).toContain("Société Équipe");
    const token = tokenFromMail(mail);
    expect(await getInvitationPreview(token)).toMatchObject({ companyName: "Société Équipe", roleName: "Expert-comptable externe" });

    // Un autre compte ne peut pas utiliser une invitation qui ne lui est pas destinée.
    const intruder = await createVerifiedUser({ email: "intrus@exemple.test" });
    await expect(acceptInvitation(await loginAs(intruder.email), token)).rejects.toMatchObject({ status: 403 });

    const accountant = await createVerifiedUser({ email: "comptable@exemple.test" });
    await acceptInvitation(await loginAs(accountant.email), token);
    const accountantAccess = await authorizeCompany(accountant.id, company.id, "accounting:write");
    expect(accountantAccess.roleKey).toBe("EXTERNAL_ACCOUNTANT");
    await expect(authorizeCompany(accountant.id, company.id, "members:manage")).rejects.toMatchObject({ status: 403 });

    // Usage unique, et le propriétaire est notifié.
    await expect(acceptInvitation(await loginAs(accountant.email), token)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "member.joined" } })).toBe(1);
  });

  it("refuse d'inviter un membre déjà présent et permet d'annuler une invitation", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "dirigeante@exemple.test" } });
    const [{ id: companyId }] = await listUserCompanies(owner.id);
    const access = await authorizeCompany(owner.id, companyId, "members:manage");
    const ownerAuth = await loginAs(owner.email);

    await expect(inviteMember(access, ownerAuth.user, { email: "comptable@exemple.test", role: "READ_ONLY" })).rejects.toMatchObject({ code: "ALREADY_MEMBER" });

    const invitation = await inviteMember(access, ownerAuth.user, { email: "futur@exemple.test", role: "COLLABORATOR" });
    const token = tokenFromMail(lastMailTo("futur@exemple.test"));
    await revokeInvitation(access, owner.id, invitation.id);
    await expect(getInvitationPreview(token)).rejects.toMatchObject({ status: 404 });
    expect((await listMembers(companyId)).invitations).toHaveLength(0);
  });

  it("protège le propriétaire et empêche de modifier son propre accès", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "dirigeante@exemple.test" } });
    const accountant = await prisma.user.findUniqueOrThrow({ where: { email: "comptable@exemple.test" } });
    const [{ id: companyId }] = await listUserCompanies(owner.id);
    const access = await authorizeCompany(owner.id, companyId, "members:manage");
    const { members } = await listMembers(companyId);
    const ownerMember = members.find((m) => m.userId === owner.id)!;
    const accountantMember = members.find((m) => m.userId === accountant.id)!;

    await expect(updateMemberRole(access, owner.id, ownerMember.id, "READ_ONLY")).rejects.toMatchObject({ status: 403 });
    await expect(removeMember(access, owner.id, ownerMember.id)).rejects.toMatchObject({ status: 403 });

    await updateMemberRole(access, owner.id, accountantMember.id, "READ_ONLY");
    await expect(authorizeCompany(accountant.id, companyId, "accounting:write")).rejects.toMatchObject({ status: 403 });

    await removeMember(access, owner.id, accountantMember.id);
    await expect(authorizeCompany(accountant.id, companyId, "dashboard:read")).rejects.toMatchObject({ status: 404 });
  });

  it("ne permet pas de gérer les membres d'une autre entreprise", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "dirigeante@exemple.test" } });
    const [{ id: companyId }] = await listUserCompanies(owner.id);
    const access = await authorizeCompany(owner.id, companyId, "members:manage");
    const foreignMember = await prisma.companyUser.findFirstOrThrow({ where: { companyId: { not: companyId } } });
    await expect(removeMember(access, owner.id, foreignMember.id)).rejects.toMatchObject({ status: 404 });
    await expect(revokeInvitation(access, owner.id, "invitation-d-une-autre-entreprise")).rejects.toMatchObject({ status: 404 });
  });

  it("plafonne le nombre d'utilisateurs selon la formule du propriétaire", async () => {
    const owner = await createVerifiedUser({ email: "solo@exemple.test", plan: "STARTER" });
    const company = await createTestCompany(owner.id, "Société Solo");
    const access = await authorizeCompany(owner.id, company.id, "members:manage");
    const auth = await loginAs(owner.email);
    await expect(inviteMember(access, auth.user, { email: "collegue@exemple.test", role: "COLLABORATOR" })).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    expect(mailsTo("collegue@exemple.test")).toHaveLength(0);
  });
});

describe("formulaire de contact et limitation de débit", () => {
  it("enregistre la demande comme ticket et accuse réception", async () => {
    const { reference } = await submitContactMessage({ name: "Ada Martin", email: "prospect@exemple.test", subject: "Question tarifaire", message: "Bonjour, quelle formule pour une SASU ?", consent: true });
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { reference }, include: { messages: true } });
    expect(ticket).toMatchObject({ source: "CONTACT_FORM", contactEmail: "prospect@exemple.test", status: "OPEN" });
    expect(ticket.messages[0].body).toContain("SASU");
    expect(lastMailTo("prospect@exemple.test").subject).toContain(reference);
  });

  it("ignore silencieusement les envois de robots (champ piège rempli)", async () => {
    const before = await prisma.supportTicket.count();
    await submitContactMessage({ name: "Robot", email: "robot@exemple.test", subject: "Spam", message: "Achetez nos produits miracles maintenant", consent: true, website: "http://spam.example" } as never);
    expect(await prisma.supportTicket.count()).toBe(before);
  });

  it("compte les requêtes par fenêtre et bloque au-delà de la limite", async () => {
    const rule = { name: "test.limite", limit: 3, windowSeconds: 60 };
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push((await consumeRateLimit(rule, "198.51.100.4")).allowed);
    expect(outcomes).toEqual([true, true, true, false, false]);
    expect((await consumeRateLimit(rule, "198.51.100.5")).allowed).toBe(true); // autre sujet, autre compteur

    // La fenêtre expirée repart de zéro.
    await prisma.$executeRaw`UPDATE rate_limit_counters SET windowStart = NOW(3) - INTERVAL 61 SECOND WHERE \`key\` LIKE 'test.limite:%'`;
    expect((await consumeRateLimit(rule, "198.51.100.4")).allowed).toBe(true);
    // Aucune adresse IP en clair dans la table.
    expect(JSON.stringify(await prisma.rateLimitCounter.findMany())).not.toContain("198.51.100");
  });
});
