import { NextResponse } from "next/server";

/**
 * Export CSV lisible par les tableurs français : séparateur point-virgule,
 * BOM UTF-8, fins de ligne CRLF. Les cellules commençant par =, +, - ou @ sont
 * neutralisées pour empêcher l'exécution de formules à l'ouverture.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined): string => {
    let cell = value === null || value === undefined ? "" : String(value);
    // Neutralisation des formules, sauf pour un nombre signé (« -115,20 »), qui doit rester un nombre dans le tableur.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(cell) && !/^[+-]?\d+([.,]\d+)?$/.test(cell)) cell = `'${cell}`;
    return /[";\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
  return "﻿" + [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n") + "\r\n";
}

/** Montant au format français pour un tableur (« 1234,56 »). */
export function csvAmount(value: { toFixed(digits: number): string } | null | undefined): string {
  return value ? value.toFixed(2).replace(".", ",") : "";
}

export function csvResponse(filename: string, content: string): Response {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
