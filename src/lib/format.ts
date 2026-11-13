/** Fonctions d'affichage (fr-FR). Les montants arrivent du serveur sous forme de chaînes décimales. */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean) {
  const key = `${currency}:${compact}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatCurrency(
  amount: string | number,
  options: { currency?: string; compact?: boolean } = {},
): string {
  const { currency = "EUR", compact = false } = options;
  // Intl accepte les chaînes décimales sans perte de précision.
  return currencyFormatter(currency, compact).format(amount as number);
}

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/** Formate une date calendaire « AAAA-MM-JJ » (ou un Date à minuit UTC). */
export function formatDate(value: string | Date, style: "short" | "long" = "short"): string {
  const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  return (style === "long" ? longDateFormatter : dateFormatter).format(date);
}

/** Formate un horodatage en heure de Paris. */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatSiren(siren: string): string {
  return siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

export function formatSiret(siret: string): string {
  return siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4");
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
