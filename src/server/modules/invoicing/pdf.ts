import path from "node:path";
import PDFDocument from "pdfkit";
import type { PrintableDocument } from "@/server/modules/invoicing/document-model";

/**
 * Rendu PDF (A4) d'un devis ou d'une facture avec PDFKit. Les polices (Liberation Sans,
 * licence SIL OFL, métriques identiques à Helvetica) sont incorporées au fichier : c'est
 * une condition du PDF/A-3, format d'archivage qui porte la facture électronique Factur-X. Mise en page : en-tête, parties,
 * tableau des lignes avec sauts de page, totaux, règlement, mentions, pied de page.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 44 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const FOOTER_HEIGHT = 46;
const BOTTOM = PAGE.height - PAGE.margin - FOOTER_HEIGHT;

const INK = "#14213D";
const MUTED = "#5B6B85";
const LINE = "#E2E8F0";
const SOFT = "#F5F7FB";

type Doc = PDFKit.PDFDocument;

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = "Corps";
const BOLD = "CorpsGras";

/** Facture électronique à incorporer : XML CII et niveau Factur-X correspondant. */
export type FacturXAttachment = { xml: string; conformanceLevel: "EN 16931"; documentDate: Date };

/** Métadonnées XMP Factur-X, avec le schéma d'extension exigé par PDF/A. */
function facturXmp(level: string): string {
  return `
        <rdf:Description xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#" rdf:about="">
            <fx:DocumentType>INVOICE</fx:DocumentType>
            <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
            <fx:Version>1.0</fx:Version>
            <fx:ConformanceLevel>${level}</fx:ConformanceLevel>
        </rdf:Description>
        <rdf:Description xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" rdf:about="">
            <pdfaExtension:schemas>
                <rdf:Bag>
                    <rdf:li rdf:parseType="Resource">
                        <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
                        <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
                        <pdfaSchema:prefix>fx</pdfaSchema:prefix>
                        <pdfaSchema:property>
                            <rdf:Seq>
                                <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
                                <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
                                <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
                                <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
                            </rdf:Seq>
                        </pdfaSchema:property>
                    </rdf:li>
                </rdf:Bag>
            </pdfaExtension:schemas>
        </rdf:Description>`;
}

/** Les polices standard ne connaissent pas les espaces insécables fines : on les remplace. */
function clean(value: string): string {
  return value.replace(/[   ]/g, " ").replace(/[−]/g, "-");
}

function money(value: string, currency: string): string {
  return clean(new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value as unknown as number));
}

function number(value: string, maxDecimals = 4): string {
  return clean(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: maxDecimals }).format(value as unknown as number));
}

function partyLines(party: PrintableDocument["seller"], withContact: boolean): string[] {
  const lines = [
    party.contactName,
    party.addressLine1,
    party.addressLine2,
    [party.postalCode, party.city].filter(Boolean).join(" ") || null,
    party.country && party.country !== "FR" ? party.country : null,
    party.siret ? `SIRET : ${party.siret}` : party.siren ? `SIREN : ${party.siren}` : null,
    party.vatNumber ? `N° TVA : ${party.vatNumber}` : null,
  ];
  if (withContact) lines.push(party.email ?? null, party.phone ?? null);
  return lines.filter((line): line is string => Boolean(line)).map(clean);
}

const COLUMNS = [
  { key: "description", label: "Désignation", width: 0, align: "left" as const },
  { key: "quantity", label: "Qté", width: 44, align: "right" as const },
  { key: "unit", label: "Unité", width: 46, align: "left" as const },
  { key: "unitPrice", label: "PU HT", width: 66, align: "right" as const },
  { key: "discount", label: "Remise", width: 44, align: "right" as const },
  { key: "vat", label: "TVA", width: 40, align: "right" as const },
  { key: "total", label: "Total HT", width: 72, align: "right" as const },
];
const CELL_PADDING = 6;
COLUMNS[0].width = CONTENT_WIDTH - COLUMNS.slice(1).reduce((acc, col) => acc + col.width, 0);

function drawTableHeader(doc: Doc, y: number, accent: string): number {
  const height = 22;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, height).fill(accent);
  doc.font(BOLD).fontSize(8.5).fillColor("#FFFFFF");
  let x = PAGE.margin;
  for (const column of COLUMNS) {
    doc.text(column.label, x + CELL_PADDING, y + 7, { width: column.width - CELL_PADDING * 2, align: column.align, lineBreak: false });
    x += column.width;
  }
  return y + height;
}

function drawWatermark(doc: Doc) {
  doc.save();
  doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
  doc.font(BOLD).fontSize(96).fillColor("#94A3B8").opacity(0.16);
  doc.text("BROUILLON", 0, PAGE.height / 2 - 48, { width: PAGE.width, align: "center", lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

export async function renderDocumentPdf(document: PrintableDocument, options: { facturX?: FacturXAttachment } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.margin,
    bufferPages: true,
    // PDF/A-3b lorsque la facture électronique est incorporée (archivage à long terme, pièce jointe XML).
    ...(options.facturX ? { subset: "PDF/A-3b", pdfVersion: "1.7", lang: "fr-FR" } : {}),
    info: {
      Title: clean(`${document.title} ${document.number ?? "(brouillon)"}`),
      Author: clean(document.seller.name),
      Creator: "ComptaPro Digital",
      ...(options.facturX ? { Subject: "Facture électronique Factur-X (profil EN 16931)" } : {}),
    },
  } as PDFKit.PDFDocumentOptions);
  doc.registerFont(REGULAR, path.join(FONTS_DIR, "LiberationSans-Regular.ttf"));
  doc.registerFont(BOLD, path.join(FONTS_DIR, "LiberationSans-Bold.ttf"));
  doc.font(REGULAR);
  if (options.facturX) {
    const pdfa = doc as unknown as {
      file(src: Uint8Array, options: { name: string; type: string; relationship: string; description: string; creationDate: Date; modifiedDate: Date }): void;
      appendXML(xml: string): void;
    };
    pdfa.file(new Uint8Array(Buffer.from(options.facturX.xml, "utf8")), {
      name: "factur-x.xml",
      type: "text/xml",
      // Profil EN 16931 : le XML est une représentation équivalente de la facture (« Alternative »).
      relationship: "Alternative",
      description: "Factur-X",
      creationDate: options.facturX.documentDate,
      modifiedDate: options.facturX.documentDate,
    });
    pdfa.appendXML(facturXmp(options.facturX.conformanceLevel));
  }
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const accent = document.accentColor;
  let y = PAGE.margin;

  // --- En-tête : logo ou nom de l'émetteur à gauche, titre et numéro à droite --
  if (document.logo) {
    try {
      doc.image(document.logo.data, PAGE.margin, y, { fit: [150, 56] });
    } catch {
      // Image illisible : on retombe sur le nom de l'entreprise.
      doc.font(BOLD).fontSize(15).fillColor(INK).text(clean(document.seller.name), PAGE.margin, y + 4, { width: 260 });
    }
  } else {
    doc.font(BOLD).fontSize(15).fillColor(INK).text(clean(document.seller.name), PAGE.margin, y + 4, { width: 260 });
  }
  doc.font(BOLD).fontSize(22).fillColor(accent).text(clean(document.title.toUpperCase()), PAGE.margin + 260, y, { width: CONTENT_WIDTH - 260, align: "right" });
  doc.font(BOLD).fontSize(11).fillColor(INK).text(clean(document.number ? `N° ${document.number}` : "Brouillon — sans numéro"), PAGE.margin + 260, y + 28, { width: CONTENT_WIDTH - 260, align: "right" });
  let metaY = y + 46;
  doc.font(REGULAR).fontSize(9).fillColor(MUTED);
  for (const date of document.dates) {
    doc.text(clean(`${date.label} : ${date.value}`), PAGE.margin + 260, metaY, { width: CONTENT_WIDTH - 260, align: "right" });
    metaY += 12;
  }
  y = Math.max(y + 70, metaY + 8);

  // --- Émetteur et client -------------------------------------------------------
  const columnWidth = (CONTENT_WIDTH - 16) / 2;
  const sellerLines = partyLines(document.seller, true);
  const buyerLines = partyLines(document.buyer, false);
  const blockHeight = 42 + Math.max(sellerLines.length, buyerLines.length) * 11.5;
  const drawParty = (x: number, heading: string, name: string, lines: string[], filled: boolean) => {
    if (filled) doc.roundedRect(x, y, columnWidth, blockHeight, 6).fill(SOFT);
    else doc.roundedRect(x, y, columnWidth, blockHeight, 6).lineWidth(0.8).stroke(LINE);
    doc.font(BOLD).fontSize(7.5).fillColor(MUTED).text(heading.toUpperCase(), x + 12, y + 9, { characterSpacing: 0.6 });
    doc.font(BOLD).fontSize(10.5).fillColor(INK).text(clean(name), x + 12, y + 20, { width: columnWidth - 24, lineBreak: false, ellipsis: true });
    doc.font(REGULAR).fontSize(8.8).fillColor(INK);
    let lineY = y + 34;
    for (const line of lines) {
      doc.text(line, x + 12, lineY, { width: columnWidth - 24, lineBreak: false, ellipsis: true });
      lineY += 11.5;
    }
  };
  drawParty(PAGE.margin, "Émetteur", document.seller.name, sellerLines, false);
  drawParty(PAGE.margin + columnWidth + 16, "Client", document.buyer.name, buyerLines, true);
  y += blockHeight + 16;

  if (document.subject) {
    doc.font(BOLD).fontSize(10).fillColor(INK).text(clean(`Objet : ${document.subject}`), PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 10;
  }

  // --- Tableau des lignes -------------------------------------------------------
  y = drawTableHeader(doc, y, accent);
  doc.font(REGULAR).fontSize(9);
  document.lines.forEach((line, index) => {
    const descriptionWidth = COLUMNS[0].width - CELL_PADDING * 2;
    const description = clean(line.description);
    const rowHeight = Math.max(20, doc.font(REGULAR).fontSize(9).heightOfString(description, { width: descriptionWidth }) + 11);
    if (y + rowHeight > BOTTOM) {
      doc.addPage();
      y = drawTableHeader(doc, PAGE.margin, accent);
    }
    if (index % 2 === 1) doc.rect(PAGE.margin, y, CONTENT_WIDTH, rowHeight).fill(SOFT);
    const cells = [
      description,
      number(line.quantity),
      line.unit ? clean(line.unit) : "",
      money(line.unitPriceExclTax, document.currency),
      Number(line.discountRate) > 0 ? `${number(line.discountRate, 2)} %` : "",
      `${number(line.vatRate, 2)} %`,
      money(line.totalExclTax, document.currency),
    ];
    let x = PAGE.margin;
    doc.font(REGULAR).fontSize(9).fillColor(INK);
    COLUMNS.forEach((column, columnIndex) => {
      doc.text(cells[columnIndex], x + CELL_PADDING, y + 6, {
        width: column.width - CELL_PADDING * 2,
        align: column.align,
        lineBreak: columnIndex === 0,
      });
      x += column.width;
    });
    y += rowHeight;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).lineWidth(0.5).stroke(LINE);
  });
  y += 14;

  // --- Totaux -------------------------------------------------------------------
  const totals = document.totals;
  const totalRows: Array<{ label: string; value: string; strong?: boolean }> = [];
  if (Number(totals.discountAmount) > 0) {
    totalRows.push({ label: "Sous-total HT", value: money(totals.subtotalExclTax, document.currency) });
    totalRows.push({ label: "Remise", value: `- ${money(totals.discountAmount, document.currency)}` });
  }
  totalRows.push({ label: "Total HT", value: money(totals.totalExclTax, document.currency) });
  for (const row of totals.vatBreakdown) {
    totalRows.push({ label: `TVA ${number(row.rate, 2)} % sur ${money(row.base, document.currency)}`, value: money(row.vat, document.currency) });
  }
  totalRows.push({ label: "Total TTC", value: money(totals.totalInclTax, document.currency), strong: true });
  if (totals.remaining !== undefined) {
    if (Number(totals.amountPaid) > 0) totalRows.push({ label: "Déjà réglé", value: `- ${money(totals.amountPaid!, document.currency)}` });
    if (Number(totals.creditedAmount) > 0) totalRows.push({ label: "Avoirs", value: `- ${money(totals.creditedAmount!, document.currency)}` });
    totalRows.push({ label: "Reste à payer", value: money(totals.remaining, document.currency), strong: true });
  }

  const totalsWidth = 250;
  const totalsX = PAGE.margin + CONTENT_WIDTH - totalsWidth;
  const totalsHeight = totalRows.reduce((acc, row) => acc + (row.strong ? 24 : 16), 0) + 6;
  const paymentHeight = document.payment.length > 0 ? 22 + document.payment.length * 13 : 0;
  if (y + Math.max(totalsHeight, paymentHeight) > BOTTOM) {
    doc.addPage();
    y = PAGE.margin;
  }
  const blockTop = y;
  for (const row of totalRows) {
    if (row.strong) {
      doc.roundedRect(totalsX, y, totalsWidth, 22, 4).fill(accent);
      doc.font(BOLD).fontSize(10.5).fillColor("#FFFFFF");
      doc.text(row.label, totalsX + 10, y + 6, { width: 110, lineBreak: false });
      doc.text(row.value, totalsX + 120, y + 6, { width: totalsWidth - 130, align: "right", lineBreak: false });
      y += 24;
    } else {
      doc.font(REGULAR).fontSize(9).fillColor(INK);
      doc.text(row.label, totalsX + 10, y + 3, { width: 150, lineBreak: false });
      doc.text(row.value, totalsX + 160, y + 3, { width: totalsWidth - 170, align: "right", lineBreak: false });
      y += 16;
    }
  }

  // --- Règlement (à gauche des totaux) -------------------------------------------
  let leftY = blockTop;
  const leftWidth = CONTENT_WIDTH - totalsWidth - 20;
  if (document.payment.length > 0) {
    doc.font(BOLD).fontSize(9).fillColor(accent).text("RÈGLEMENT", PAGE.margin, leftY, { characterSpacing: 0.6 });
    leftY += 14;
    for (const item of document.payment) {
      doc.font(BOLD).fontSize(8.5).fillColor(INK).text(clean(`${item.label} : `), PAGE.margin, leftY, { continued: true, width: leftWidth });
      doc.font(REGULAR).text(clean(item.value), { width: leftWidth });
      leftY = doc.y + 2;
    }
  }
  y = Math.max(y, leftY) + 14;

  // --- Notes, mentions, signature ---------------------------------------------------
  const paragraph = (text: string, options: { bold?: boolean; size?: number; color?: string } = {}) => {
    const content = clean(text);
    doc.font(options.bold ? BOLD : REGULAR).fontSize(options.size ?? 8.5);
    const height = doc.heightOfString(content, { width: CONTENT_WIDTH });
    if (y + height > BOTTOM) {
      doc.addPage();
      y = PAGE.margin;
    }
    doc.fillColor(options.color ?? INK).text(content, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 5;
  };
  if (document.notes) paragraph(document.notes, { size: 9 });
  if (document.signatureBlock) {
    if (y + 92 > BOTTOM) {
      doc.addPage();
      y = PAGE.margin;
    }
    y += 6;
    doc.roundedRect(totalsX, y, totalsWidth, 80, 6).lineWidth(0.8).stroke(LINE);
    doc.font(BOLD).fontSize(9).fillColor(INK).text("Bon pour accord", totalsX + 10, y + 9);
    doc.font(REGULAR).fontSize(8).fillColor(MUTED).text("Date, nom et signature du client", totalsX + 10, y + 22);
    y += 92;
  }
  if (document.mentions.length > 0) {
    y += 4;
    for (const mention of document.mentions) paragraph(mention, { size: 7.8, color: MUTED });
  }

  // --- Pied de page et filigrane sur toutes les pages -------------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (document.draft) drawWatermark(doc);
    const footerY = PAGE.height - PAGE.margin - FOOTER_HEIGHT + 16;
    doc.moveTo(PAGE.margin, footerY).lineTo(PAGE.margin + CONTENT_WIDTH, footerY).lineWidth(0.5).stroke(LINE);
    doc.font(REGULAR).fontSize(7.5).fillColor(MUTED);
    doc.text(clean(document.footer), PAGE.margin, footerY + 7, { width: CONTENT_WIDTH - 70, height: 20, lineBreak: true });
    doc.text(`Page ${i - range.start + 1} / ${range.count}`, PAGE.margin + CONTENT_WIDTH - 70, footerY + 7, { width: 70, align: "right", lineBreak: false });
  }

  doc.end();
  return finished;
}

export function pdfFileName(document: Pick<PrintableDocument, "title" | "number">): string {
  const base = `${document.title}-${document.number ?? "brouillon"}`;
  return `${base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase()}.pdf`;
}
