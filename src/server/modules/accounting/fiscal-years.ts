import type { FiscalYear } from "@prisma/client";
import { errors } from "@/server/http/errors";
import { fiscalYearBounds } from "@/server/modules/companies/fiscal-year";
import { addDays, fromIsoDate, toIsoDate, type IsoDate } from "@/lib/dates";
import type { Tx } from "./setup";

/** Exercice contenant une date ; créé s'il n'existe pas encore (mêmes bornes que les exercices de l'entreprise). */
export async function fiscalYearFor(tx: Tx, company: { id: string; fiscalYearStartMonth: number }, date: IsoDate): Promise<FiscalYear> {
  const found = await tx.fiscalYear.findFirst({ where: { companyId: company.id, startDate: { lte: fromIsoDate(date) }, endDate: { gte: fromIsoDate(date) } } });
  if (found) return found;
  // Les exercices existants fixent le calendrier ; à défaut, le mois d'ouverture de l'entreprise.
  const reference = await tx.fiscalYear.findFirst({ where: { companyId: company.id }, orderBy: { startDate: "asc" } });
  const startMonth = reference ? Number(toIsoDate(reference.startDate).slice(5, 7)) : company.fiscalYearStartMonth;
  const bounds = fiscalYearBounds(startMonth, date);
  const overlapping = await tx.fiscalYear.findFirst({
    where: { companyId: company.id, startDate: { lte: fromIsoDate(bounds.endDate) }, endDate: { gte: fromIsoDate(bounds.startDate) } },
  });
  if (overlapping) throw errors.badRequest("FISCAL_YEAR_GAP", "Les exercices de l'entreprise ne couvrent pas cette date : vérifiez leurs dates.");
  return tx.fiscalYear.upsert({
    where: { companyId_startDate: { companyId: company.id, startDate: fromIsoDate(bounds.startDate) } },
    create: { companyId: company.id, label: bounds.label, startDate: fromIsoDate(bounds.startDate), endDate: fromIsoDate(bounds.endDate) },
    update: {},
  });
}

/** Une date est-elle ouverte à l'écriture : exercice non clôturé et période non verrouillée ? */
export function isOpenFor(fiscalYear: FiscalYear, date: IsoDate): boolean {
  if (fiscalYear.status === "CLOSED") return false;
  return !fiscalYear.lockedThrough || date > toIsoDate(fiscalYear.lockedThrough);
}

/**
 * Date de comptabilisation d'une pièce : sa propre date si la période est
 * ouverte ; sinon le premier jour non verrouillé qui suit. Une correction ne
 * modifie donc jamais une période close.
 */
export async function postingDate(tx: Tx, company: { id: string; fiscalYearStartMonth: number }, date: IsoDate): Promise<{ date: IsoDate; fiscalYear: FiscalYear }> {
  let candidate = date;
  for (let guard = 0; guard < 50; guard++) {
    const fiscalYear = await fiscalYearFor(tx, company, candidate);
    if (isOpenFor(fiscalYear, candidate)) return { date: candidate, fiscalYear };
    const end = toIsoDate(fiscalYear.endDate);
    const next = fiscalYear.status === "CLOSED" ? addDays(end, 1) : addDays(toIsoDate(fiscalYear.lockedThrough!), 1);
    candidate = next > end ? addDays(end, 1) : next;
  }
  throw errors.badRequest("NO_OPEN_PERIOD", "Aucune période ouverte n'est disponible pour cette écriture.");
}
