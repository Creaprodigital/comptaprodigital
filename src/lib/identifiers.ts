/** Contrôles des identifiants d'entreprise français (module pur, partagé client/serveur). */

function luhnChecksum(digits: string): number {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10;
}

export function normalizeDigits(value: string): string {
  return value.replace(/[\s.\-]/g, "");
}

export function isValidSiren(value: string): boolean {
  const siren = normalizeDigits(value);
  return /^\d{9}$/.test(siren) && luhnChecksum(siren) === 0;
}

const LA_POSTE_SIREN = "356000000";

export function isValidSiret(value: string): boolean {
  const siret = normalizeDigits(value);
  if (!/^\d{14}$/.test(siret)) return false;
  if (siret.startsWith(LA_POSTE_SIREN)) {
    // Cas particulier des établissements de La Poste : somme des chiffres multiple de 5.
    if (siret === `${LA_POSTE_SIREN}00048`) return true;
    const digitSum = [...siret].reduce((acc, c) => acc + Number(c), 0);
    return digitSum % 5 === 0;
  }
  return luhnChecksum(siret) === 0 && isValidSiren(siret.slice(0, 9));
}

/** Numéro de TVA intracommunautaire français déduit du SIREN : FR + clé + SIREN. */
export function frenchVatNumberFromSiren(value: string): string | null {
  const siren = normalizeDigits(value);
  if (!isValidSiren(siren)) return null;
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${siren}`;
}

export function isValidFrenchVatNumber(value: string): boolean {
  const vat = value.replace(/\s/g, "").toUpperCase();
  const match = /^FR(\d{2})(\d{9})$/.exec(vat);
  if (!match) return false;
  return frenchVatNumberFromSiren(match[2]) === vat;
}
