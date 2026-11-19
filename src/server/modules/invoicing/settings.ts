import type { Company } from "@prisma/client";
import { assertFileIsSafe } from "@/server/security/antivirus";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";
import { recordAudit } from "@/server/audit/audit";
import type { CompanyAccess } from "@/server/rbac/service";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";
import type { BillingSettingsInput } from "@/lib/schemas/invoicing";
import type { Meta } from "@/server/modules/invoicing/shared";

const MAX_LOGO_BYTES = 500 * 1024;

export type BillingSettingsView = {
  invoicePrefix: string;
  quotePrefix: string;
  creditNotePrefix: string;
  defaultPaymentTermDays: number;
  quoteValidityDays: number;
  latePenaltyRate: string;
  earlyPaymentDiscountNote: string;
  invoiceFooter: string;
  invoiceAccentColor: string;
  rcsCity: string;
  shareCapital: string;
  /** IBAN masqué : seuls les quatre derniers caractères sont renvoyés au navigateur. */
  ibanMasked: string | null;
  bic: string;
  remindersEnabled: boolean;
  reminderDelaysDays: number[];
  hasLogo: boolean;
  /** Les préfixes ne sont plus modifiables dès qu'une facture a été émise. */
  prefixesLocked: boolean;
};

export async function getBillingSettings(access: CompanyAccess): Promise<BillingSettingsView> {
  const company = access.company;
  const [logo, issuedCount] = await Promise.all([
    prisma.companyLogo.findUnique({ where: { companyId: company.id }, select: { companyId: true } }),
    access.db.invoice.count({ where: { number: { not: null } } }),
  ]);
  let ibanMasked: string | null = null;
  if (company.ibanEncrypted) {
    const iban = decryptSecret(company.ibanEncrypted);
    ibanMasked = `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
  }
  const delays = Array.isArray(company.reminderDelaysDays) ? (company.reminderDelaysDays as unknown[]).filter((d): d is number => typeof d === "number") : [7, 15, 30];
  return {
    invoicePrefix: company.invoicePrefix,
    quotePrefix: company.quotePrefix,
    creditNotePrefix: company.creditNotePrefix,
    defaultPaymentTermDays: company.defaultPaymentTermDays,
    quoteValidityDays: company.quoteValidityDays,
    latePenaltyRate: company.latePenaltyRate?.toFixed(2) ?? "",
    earlyPaymentDiscountNote: company.earlyPaymentDiscountNote ?? "",
    invoiceFooter: company.invoiceFooter ?? "",
    invoiceAccentColor: company.invoiceAccentColor,
    rcsCity: company.rcsCity ?? "",
    shareCapital: company.shareCapital?.toFixed(2) ?? "",
    ibanMasked,
    bic: company.bic ?? "",
    remindersEnabled: company.remindersEnabled,
    reminderDelaysDays: delays,
    hasLogo: logo !== null,
    prefixesLocked: issuedCount > 0,
  };
}

export async function updateBillingSettings(
  access: CompanyAccess,
  userId: string,
  input: BillingSettingsInput & { keepIban?: boolean },
  meta: Meta = {},
): Promise<Company> {
  const company = access.company;
  const issuedCount = await access.db.invoice.count({ where: { number: { not: null } } });
  const prefixChanged = input.invoicePrefix !== company.invoicePrefix || input.creditNotePrefix !== company.creditNotePrefix;
  if (issuedCount > 0 && prefixChanged) {
    // Changer de préfixe en cours de route casserait la lisibilité de la séquence chronologique.
    throw errors.conflict("PREFIX_LOCKED", "Les préfixes des factures et des avoirs ne sont plus modifiables après la première émission.");
  }
  if (input.creditNotePrefix === input.invoicePrefix) {
    throw errors.validation([{ path: "creditNotePrefix", message: "Le préfixe des avoirs doit différer de celui des factures" }]);
  }
  const updated = await prisma.company.update({
    where: { id: company.id },
    data: {
      invoicePrefix: input.invoicePrefix,
      quotePrefix: input.quotePrefix,
      creditNotePrefix: input.creditNotePrefix,
      defaultPaymentTermDays: input.defaultPaymentTermDays,
      quoteValidityDays: input.quoteValidityDays,
      latePenaltyRate: input.latePenaltyRate ?? null,
      earlyPaymentDiscountNote: input.earlyPaymentDiscountNote ?? null,
      invoiceFooter: input.invoiceFooter ?? null,
      invoiceAccentColor: input.invoiceAccentColor,
      rcsCity: input.rcsCity ?? null,
      shareCapital: input.shareCapital ?? null,
      // IBAN chiffré au repos ; « keepIban » conserve la valeur existante lorsque le champ n'a pas été ressaisi.
      ...(input.keepIban ? {} : { ibanEncrypted: input.iban ? encryptSecret(input.iban) : null }),
      bic: input.bic ?? null,
      remindersEnabled: input.remindersEnabled,
      reminderDelaysDays: input.reminderDelaysDays,
    },
  });
  await recordAudit({ action: "company.billing_settings", userId, companyId: company.id, entityType: "Company", entityId: company.id, ...meta });
  return updated;
}

/** Vérifie la signature binaire de l'image : le type annoncé par le navigateur ne suffit pas. */
function detectImageType(data: Buffer): "image/png" | "image/jpeg" | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

export async function saveLogo(access: CompanyAccess, userId: string, input: { mimeType: string; dataBase64: string }, meta: Meta = {}): Promise<void> {
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length === 0 || data.length > MAX_LOGO_BYTES) {
    throw errors.validation([{ path: "dataBase64", message: "Le logo doit peser moins de 500 Ko" }]);
  }
  const detected = detectImageType(data);
  if (!detected || detected !== input.mimeType) {
    throw errors.validation([{ path: "dataBase64", message: "Le fichier n'est pas une image PNG ou JPEG valide" }]);
  }
  await assertFileIsSafe(data);
  await prisma.companyLogo.upsert({
    where: { companyId: access.company.id },
    create: { companyId: access.company.id, mimeType: detected, data, sizeBytes: data.length },
    update: { mimeType: detected, data, sizeBytes: data.length },
  });
  await recordAudit({ action: "company.logo_updated", userId, companyId: access.company.id, entityType: "Company", entityId: access.company.id, ...meta });
}

export async function getLogo(companyId: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const logo = await prisma.companyLogo.findUnique({ where: { companyId } });
  return logo ? { mimeType: logo.mimeType, data: Buffer.from(logo.data) } : null;
}

export async function deleteLogo(access: CompanyAccess, userId: string, meta: Meta = {}): Promise<void> {
  await prisma.companyLogo.deleteMany({ where: { companyId: access.company.id } });
  await recordAudit({ action: "company.logo_deleted", userId, companyId: access.company.id, entityType: "Company", entityId: access.company.id, ...meta });
}
