import type { EntrySource } from "@prisma/client";
import type { CompanyAccess } from "@/server/rbac/service";
import { toIsoDate } from "@/lib/dates";

/** Lien vers la pièce d'origine d'une écriture générée. */
export async function sourceHref(access: CompanyAccess, sourceType: EntrySource, sourceId: string | null): Promise<string | null> {
  if (!sourceId) return null;
  switch (sourceType) {
    case "INVOICE":
      return `/app/factures/${sourceId}`;
    case "PAYMENT": {
      const payment = await access.db.payment.findFirst({ where: { id: sourceId }, select: { invoiceId: true } });
      return payment ? `/app/factures/${payment.invoiceId}` : null;
    }
    case "PURCHASE":
      return `/app/achats/${sourceId}`;
    case "BANK_TRANSACTION":
      return (await access.db.bankTransaction.findFirst({ where: { id: sourceId }, select: { id: true } })) ? `/app/banque/operations/${sourceId}` : null;
    case "VAT_RETURN": {
      const period = await access.db.vatPeriod.findFirst({ where: { id: sourceId }, select: { startDate: true } });
      return period ? `/app/tva/${toIsoDate(period.startDate)}` : null;
    }
    case "DEPRECIATION":
      return "/app/comptabilite/immobilisations";
    case "ASSET_DISPOSAL":
      return `/app/comptabilite/immobilisations/${sourceId}`;
    case "OPENING":
      return "/app/banque/comptes";
    case "CLOSING":
      return "/app/comptabilite/exercices";
    default:
      return null;
  }
}
