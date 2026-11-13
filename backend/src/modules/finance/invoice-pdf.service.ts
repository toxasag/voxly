import fs from "node:fs";
import path from "node:path";
import type { InvoiceDTO } from "./finance.types.js";
import { amountToWords } from "./amount-to-words.js";

interface PrintSettings {
  company_name?: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_website?: string;
  company_inn?: string;
  company_ogrn?: string;
  bank_name?: string;
  bik?: string;
  corr_account?: string;
  settlement_account?: string;
  company_kpp?: string;
  director_name?: string;
  accountant_name?: string;
}

interface FontMetrics {
  charToGid: (code: number) => number;
  getWidth: (gid: number, fontSize: number) => number;
  ttfBuffer: Buffer;
  ascent: number;
  descent: number;
}

function resolveFontPath(name: string): string {
  const candidates = [
    path.join(process.cwd(), "public", "fonts", name),
    path.join(process.cwd(), "backend", "public", "fonts", name),
    path.join("/usr/share/fonts/truetype/dejavu", name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] ?? "";
}

function loadFontMetrics(fontFile: string): FontMetrics {
  const buf = fs.readFileSync(fontFile);
  const numTables = buf.readUInt16BE(4);
  let cmapOffset = 0;
  let hheaOffset = 0;
  let hmtxOffset = 0;
  let headOffset = 0;

  for (let i = 0; i < numTables; i++) {
    const tag = buf.toString("ascii", 12 + i * 16, 12 + i * 16 + 4);
    const offset = buf.readUInt32BE(12 + i * 16 + 8);
    if (tag === "cmap") cmapOffset = offset;
    if (tag === "hhea") hheaOffset = offset;
    if (tag === "hmtx") hmtxOffset = offset;
    if (tag === "head") headOffset = offset;
  }

  const unitsPerEm = headOffset ? buf.readUInt16BE(headOffset + 18) : 1000;
  const ascent = hheaOffset ? buf.readInt16BE(hheaOffset + 4) : 928;
  const descent = hheaOffset ? buf.readInt16BE(hheaOffset + 6) : -236;
  const numOfLongHorMetrics = hheaOffset ? buf.readUInt16BE(hheaOffset + 34) : 1;

  // Find Windows Unicode BMP format 4 in cmap
  const subtableCount = buf.readUInt16BE(cmapOffset + 2);
  let format4Offset = 0;
  for (let i = 0; i < subtableCount; i++) {
    const pId = buf.readUInt16BE(cmapOffset + 4 + i * 8);
    const eId = buf.readUInt16BE(cmapOffset + 4 + i * 8 + 2);
    const subOffset = cmapOffset + buf.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(subOffset);
    if (pId === 3 && (eId === 1 || eId === 0) && format === 4) {
      format4Offset = subOffset;
      break;
    }
  }

  const segCount = buf.readUInt16BE(format4Offset + 6) / 2;
  const endCodeOff = format4Offset + 14;
  const startCodeOff = endCodeOff + segCount * 2 + 2;
  const idDeltaOff = startCodeOff + segCount * 2;
  const idRangeOffsetOff = idDeltaOff + segCount * 2;

  const charToGid = (code: number): number => {
    for (let i = 0; i < segCount; i++) {
      const end = buf.readUInt16BE(endCodeOff + i * 2);
      if (code <= end) {
        const start = buf.readUInt16BE(startCodeOff + i * 2);
        if (code >= start) {
          const idDelta = buf.readInt16BE(idDeltaOff + i * 2);
          const ro = buf.readUInt16BE(idRangeOffsetOff + i * 2);
          if (ro === 0) {
            return (code + idDelta) & 0xffff;
          }
          const roAddr = idRangeOffsetOff + i * 2 + ro + (code - start) * 2;
          const gid = buf.readUInt16BE(roAddr);
          return gid !== 0 ? (gid + idDelta) & 0xffff : 0;
        }
        break;
      }
    }
    return 0;
  };

  const getWidth = (gid: number, fontSize: number): number => {
    let raw = 0;
    if (gid < numOfLongHorMetrics) {
      raw = buf.readUInt16BE(hmtxOffset + gid * 4);
    } else {
      raw = buf.readUInt16BE(hmtxOffset + (numOfLongHorMetrics - 1) * 4);
    }
    return (raw / unitsPerEm) * fontSize;
  };

  return { charToGid, getWidth, ttfBuffer: buf, ascent, descent };
}

let regularFontMetrics: FontMetrics | null = null;
let boldFontMetrics: FontMetrics | null = null;

function getFonts(): { reg: FontMetrics; bold: FontMetrics } {
  if (!regularFontMetrics) {
    const regPath = resolveFontPath("DejaVuSans.ttf");
    regularFontMetrics = loadFontMetrics(regPath);
  }
  if (!boldFontMetrics) {
    const boldPath = resolveFontPath("DejaVuSans-Bold.ttf");
    boldFontMetrics = loadFontMetrics(boldPath);
  }
  return { reg: regularFontMetrics, bold: boldFontMetrics };
}

function formatDateRu(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return isoString;
  }
}

function formatRubles(val: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function generateInvoicePdfBuffer(
  invoice: InvoiceDTO,
  settings: PrintSettings = {},
): Buffer {
  const { reg, bold } = getFonts();

  // Page dimensions (A4: 595.28 x 841.89 pt)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 36; // 0.5 inch margins
  const contentWidth = pageWidth - marginX * 2; // 523.28 pt

  const usedGidsReg = new Map<number, number>();
  const usedGidsBold = new Map<number, number>();

  function textToGidHex(text: string, isBold: boolean): string {
    const font = isBold ? bold : reg;
    const usedMap = isBold ? usedGidsBold : usedGidsReg;
    let hex = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const gid = font.charToGid(code);
      usedMap.set(gid, code);
      hex += gid.toString(16).padStart(4, "0");
    }
    return hex;
  }

  function measureText(text: string, fontSize: number, isBold: boolean): number {
    const font = isBold ? bold : reg;
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const gid = font.charToGid(text.charCodeAt(i));
      w += font.getWidth(gid, fontSize);
    }
    return w;
  }

  const streamOps: string[] = [];

  function drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    isBold = false,
    color = "0 0 0",
  ): void {
    if (!text) return;
    const hex = textToGidHex(text, isBold);
    const fontTag = isBold ? "/F2" : "/F1";
    streamOps.push(
      `BT ${color} rg ${fontTag} ${fontSize} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex}> Tj ET`,
    );
  }

  function drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    lineWidth = 0.5,
    strokeColor = "0.8 0.8 0.8",
    fillColor?: string,
  ): void {
    if (fillColor) {
      streamOps.push(
        `q ${fillColor} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`,
      );
    }
    if (lineWidth > 0) {
      streamOps.push(
        `q ${lineWidth} w ${strokeColor} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`,
      );
    }
  }

  function drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth = 0.5,
    color = "0.7 0.7 0.7",
  ): void {
    streamOps.push(
      `q ${lineWidth} w ${color} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`,
    );
  }

  function wrapText(
    text: string,
    maxWidth: number,
    fontSize: number,
    isBold: boolean,
  ): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let curLine = "";

    for (const w of words) {
      const testLine = curLine ? `${curLine} ${w}` : w;
      if (measureText(testLine, fontSize, isBold) <= maxWidth) {
        curLine = testLine;
      } else {
        if (curLine) lines.push(curLine);
        curLine = w;
      }
    }
    if (curLine) lines.push(curLine);
    return lines;
  }

  // Current drawing cursor from top
  let curY = pageHeight - 36;

  // 1. Top Notice box
  const noticeText =
    "Внимание! Оплата данного счета означает согласие с условиями поставки товара / оказания услуг. Уведомление об оплате обязательно, в противном случае не гарантируется сохранение цены и наличие товара. Товар/услуга отпускается по факту прихода денег на р/с Поставщика.";
  const noticeLines = wrapText(noticeText, contentWidth - 12, 7.5, false);
  const noticeBoxH = noticeLines.length * 10 + 8;
  curY -= noticeBoxH;
  drawRect(marginX, curY, contentWidth, noticeBoxH, 0.5, "0.85 0.85 0.85", "0.98 0.98 0.98");
  noticeLines.forEach((line, idx) => {
    drawText(line, marginX + 6, curY + noticeBoxH - 10 - idx * 10, 7.5, false, "0.4 0.4 0.4");
  });

  curY -= 14;

  // 2. Bank Requisites Table (Образец заполнения платежного поручения)
  const bankTableH = 75;
  curY -= bankTableH;
  const bY = curY;
  const bX = marginX;
  const bW = contentWidth;

  drawRect(bX, bY, bW, bankTableH, 0.75, "0.3 0.3 0.3");

  const colBankW = 270;
  const colBikW = 55;

  // Split lines
  drawLine(bX + colBankW, bY, bX + colBankW, bY + bankTableH, 0.5, "0.3 0.3 0.3");
  drawLine(bX + colBankW + colBikW, bY, bX + colBankW + colBikW, bY + bankTableH, 0.5, "0.3 0.3 0.3");
  drawLine(bX, bY + 38, bX + bW, bY + 38, 0.5, "0.3 0.3 0.3");
  drawLine(bX, bY + 56, bX + colBankW, bY + 56, 0.5, "0.3 0.3 0.3");

  const bankName = settings.bank_name || "АО «ТИНЬКОФФ БАНК»";
  const bik = settings.bik || "044525974";
  const corrAcc = settings.corr_account || "30101810145250000974";
  const settAcc = settings.settlement_account || "40802810800003429185";
  const inn = settings.company_inn || "771501234567";
  const kpp = settings.company_kpp || "";
  const compName = settings.company_name || "ИП Сагайдак А.Г.";

  // Bank name
  drawText(bankName, bX + 5, bY + bankTableH - 12, 8.5, true);
  drawText("Банк получателя", bX + 5, bY + 41, 7, false, "0.5 0.5 0.5");

  // BIK
  drawText("БИК", bX + colBankW + 5, bY + bankTableH - 12, 8, false);
  drawText(bik, bX + colBankW + colBikW + 5, bY + bankTableH - 12, 8.5, true);

  // Corr Account
  drawText("Сч. №", bX + colBankW + 5, bY + 44, 8, false);
  drawText(corrAcc, bX + colBankW + colBikW + 5, bY + 44, 8.5, true);

  // INN / KPP
  const innKpp = kpp ? `ИНН ${inn}   КПП ${kpp}` : `ИНН ${inn}`;
  drawText(innKpp, bX + 5, bY + 26, 8.5, true);

  // Settlement Account
  drawText("Сч. №", bX + colBankW + 5, bY + 18, 8, false);
  drawText(settAcc, bX + colBankW + colBikW + 5, bY + 18, 8.5, true);

  // Beneficiary Name
  drawText(compName, bX + 5, bY + 8, 8.5, true);
  drawText("Получатель", bX + 5, bY + 2, 7, false, "0.5 0.5 0.5");

  curY -= 20;

  // 3. Invoice Title
  const issueDateFormatted = formatDateRu(invoice.issueDate);
  const titleText = `Счёт на оплату № ${invoice.invoiceNumber} от ${issueDateFormatted}`;
  drawText(titleText, marginX, curY, 13, true, "0.05 0.05 0.05");

  curY -= 6;
  drawLine(marginX, curY, marginX + contentWidth, curY, 1.5, "0.2 0.2 0.2");

  curY -= 14;

  // 4. Supplier, Buyer, Basis Details
  const supplierLabel = "Поставщик:";
  const supplierDetails = `${compName}, ИНН ${inn}${kpp ? `, КПП ${kpp}` : ""}${
    settings.company_address ? `, ${settings.company_address}` : ""
  }${settings.company_phone ? `, тел.: ${settings.company_phone}` : ""}`;
  const supLines = wrapText(supplierDetails, contentWidth - 85, 8.5, false);

  drawText(supplierLabel, marginX, curY, 8.5, true);
  supLines.forEach((l, idx) => {
    drawText(l, marginX + 75, curY - idx * 11, 8.5, false);
  });
  curY -= supLines.length * 11 + 5;

  const buyerLabel = "Покупатель:";
  const buyerName = invoice.companyName || invoice.contactName || "Физическое лицо";
  const buyerDetails = `${buyerName}${invoice.companyInn ? `, ИНН ${invoice.companyInn}` : ""}${
    invoice.companyAddress ? `, ${invoice.companyAddress}` : ""
  }${invoice.contactPhone ? `, тел.: ${invoice.contactPhone}` : ""}`;
  const buyLines = wrapText(buyerDetails, contentWidth - 85, 8.5, false);

  drawText(buyerLabel, marginX, curY, 8.5, true);
  buyLines.forEach((l, idx) => {
    drawText(l, marginX + 75, curY - idx * 11, 8.5, false);
  });
  curY -= buyLines.length * 11 + 5;

  // Basis
  const lineItems = invoice.lineItems ?? [];
  const basisLabel = "Основание:";
  const acts = Array.from(
    new Set(lineItems.map((li) => li.sourceLabel).filter(Boolean)),
  );
  const basisDetails = acts.length > 0 ? `Наряд-заказ(ы) ${acts.join(", ")}` : "Оказание услуг / ремонт";
  drawText(basisLabel, marginX, curY, 8.5, true);
  drawText(basisDetails, marginX + 75, curY, 8.5, false);

  curY -= 16;

  // 5. Line Items Table
  const col1W = 24; // №
  const col3W = 42; // Кол-во
  const col4W = 34; // Ед.
  const col5W = 65; // Цена
  const col6W = 75; // Сумма
  const col2W = contentWidth - (col1W + col3W + col4W + col5W + col6W); // Name

  const headerH = 18;
  curY -= headerH;
  drawRect(marginX, curY, contentWidth, headerH, 0.75, "0.3 0.3 0.3", "0.94 0.94 0.94");

  const x1 = marginX;
  const x2 = x1 + col1W;
  const x3 = x2 + col2W;
  const x4 = x3 + col3W;
  const x5 = x4 + col4W;
  const x6 = x5 + col5W;

  drawLine(x2, curY, x2, curY + headerH, 0.5, "0.3 0.3 0.3");
  drawLine(x3, curY, x3, curY + headerH, 0.5, "0.3 0.3 0.3");
  drawLine(x4, curY, x4, curY + headerH, 0.5, "0.3 0.3 0.3");
  drawLine(x5, curY, x5, curY + headerH, 0.5, "0.3 0.3 0.3");
  drawLine(x6, curY, x6, curY + headerH, 0.5, "0.3 0.3 0.3");

  drawText("№", x1 + 6, curY + 5, 8, true);
  drawText("Товары (работы, услуги)", x2 + 6, curY + 5, 8, true);
  drawText("Кол-во", x3 + 5, curY + 5, 8, true);
  drawText("Ед.", x4 + 8, curY + 5, 8, true);
  drawText("Цена", x5 + 15, curY + 5, 8, true);
  drawText("Сумма", x6 + 18, curY + 5, 8, true);

  // Table rows
  lineItems.forEach((item, index) => {
    const itemTitle = item.sourceLabel
      ? `${item.description} (${item.sourceLabel})`
      : item.description;
    const lines = wrapText(itemTitle, col2W - 12, 8, false);
    const rowH = Math.max(16, lines.length * 10 + 6);
    curY -= rowH;

    drawRect(marginX, curY, contentWidth, rowH, 0.5, "0.5 0.5 0.5");

    drawLine(x2, curY, x2, curY + rowH, 0.5, "0.5 0.5 0.5");
    drawLine(x3, curY, x3, curY + rowH, 0.5, "0.5 0.5 0.5");
    drawLine(x4, curY, x4, curY + rowH, 0.5, "0.5 0.5 0.5");
    drawLine(x5, curY, x5, curY + rowH, 0.5, "0.5 0.5 0.5");
    drawLine(x6, curY, x6, curY + rowH, 0.5, "0.5 0.5 0.5");

    drawText(String(index + 1), x1 + 6, curY + rowH - 11, 8, false);

    lines.forEach((l, lIdx) => {
      drawText(l, x2 + 5, curY + rowH - 11 - lIdx * 10, 8, false);
    });

    drawText(String(item.quantity), x3 + 12, curY + rowH - 11, 8, false);
    drawText("шт.", x4 + 8, curY + rowH - 11, 8, false);

    const priceStr = formatRubles(item.unitPrice);
    const totalStr = formatRubles(item.total);
    drawText(priceStr, x5 + col5W - measureText(priceStr, 8, false) - 6, curY + rowH - 11, 8, false);
    drawText(totalStr, x6 + col6W - measureText(totalStr, 8, false) - 6, curY + rowH - 11, 8, false);
  });

  curY -= 14;

  // 6. Totals block
  const totalsW = 180;
  const totalsX = marginX + contentWidth - totalsW;

  const subtotalStr = formatRubles(invoice.subtotal);
  drawText("Итого:", totalsX, curY, 9, true);
  drawText(subtotalStr, marginX + contentWidth - measureText(subtotalStr, 9, true) - 6, curY, 9, true);
  curY -= 12;

  const vatRate = invoice.vatRate ?? 20;
  if (vatRate > 0) {
    const vatStr = formatRubles(invoice.vatAmount);
    drawText(`В том числе НДС (${vatRate}%):`, totalsX - 25, curY, 8.5, false);
    drawText(vatStr, marginX + contentWidth - measureText(vatStr, 8.5, false) - 6, curY, 8.5, false);
  } else {
    drawText("Без налога (НДС)", totalsX, curY, 8.5, false);
    drawText("—", marginX + contentWidth - 16, curY, 8.5, false);
  }
  curY -= 14;

  const totalStr = `${formatRubles(invoice.total)} руб.`;
  drawText("Всего к оплате:", totalsX, curY, 10.5, true);
  drawText(totalStr, marginX + contentWidth - measureText(totalStr, 10.5, true) - 6, curY, 10.5, true);

  curY -= 16;

  // 7. Amount in words
  const rubles = Math.floor(invoice.total);
  const kopecks = Math.round((invoice.total - rubles) * 100);
  const wordsStr = amountToWords(rubles, kopecks);

  const countSummary = `Всего наименований ${lineItems.length}, на сумму ${formatRubles(invoice.total)} руб.`;
  drawText(countSummary, marginX, curY, 8.5, false);
  curY -= 12;
  drawText(wordsStr, marginX, curY, 8.5, true);

  curY -= 8;
  drawLine(marginX, curY, marginX + contentWidth, curY, 1, "0.2 0.2 0.2");

  curY -= 28;

  // 8. Signatures Block
  const sigDirector = settings.director_name || compName;
  const sigAccountant = settings.accountant_name || sigDirector;

  drawText("Руководитель", marginX, curY, 8.5, true);
  drawLine(marginX + 75, curY - 2, marginX + 220, curY - 2, 0.5, "0.2 0.2 0.2");
  drawText(`(${sigDirector})`, marginX + 225, curY, 8.5, false);

  drawText("Бухгалтер", marginX + 330, curY, 8.5, true);
  drawLine(marginX + 380, curY - 2, marginX + 460, curY - 2, 0.5, "0.2 0.2 0.2");
  drawText(`(${sigAccountant})`, marginX + 465, curY, 8.5, false);

  curY -= 30;
  drawText("М.П.", marginX + 90, curY, 9, false, "0.6 0.6 0.6");

  // Build PDF document objects
  const objects: (string | Buffer)[] = [];

  function addObj(content: string | Buffer): number {
    objects.push(content);
    return objects.length;
  }

  // 1: Catalog
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // 3: Page (A4)
  addObj(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 9 0 R >> >> /Contents 14 0 R >>`,
  );

  // F1: Regular Font (Type0)
  addObj(
    "<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>",
  );
  // 5: CIDFontType2 (Reg)
  addObj(
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /CIDToGIDMap /Identity /W [0 65535 1000] >>",
  );
  // 6: FontDescriptor (Reg)
  addObj(
    `<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [-1029 -415 1681 1167] /ItalicAngle 0 /Ascent ${reg.ascent} /Descent ${reg.descent} /CapHeight 729 /StemV 70 /FontFile2 8 0 R >>`,
  );

  // 7: ToUnicode CMap (Reg)
  function buildCmap(gidsMap: Map<number, number>): string {
    const entries = Array.from(gidsMap.entries());
    let mappings = "";
    for (const [gid, code] of entries) {
      mappings += `<${gid.toString(16).padStart(4, "0")}> <${code.toString(16).padStart(4, "0")}>\n`;
    }
    const count = entries.length;
    return (
      "/CIDInit /ProcSet findresource begin\n" +
      "12 dict begin\n" +
      "begincmap\n" +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
      "/CMapName /Custom-ToUnicode def\n" +
      "/CMapType 2 def\n" +
      "1 begincodespacerange\n" +
      "<0000> <FFFF>\n" +
      "endcodespacerange\n" +
      `${count} beginbfchar\n` +
      mappings +
      "endbfchar\n" +
      "endcmap\n" +
      "CMapName currentdict /CMap defineresource pop\n" +
      "end\n" +
      "end"
    );
  }

  const cmapReg = buildCmap(usedGidsReg);
  addObj(`<< /Length ${cmapReg.length} >>\nstream\n${cmapReg}\nendstream`);

  // 8: FontFile2 (Reg TTF)
  addObj(
    Buffer.concat([
      Buffer.from(`<< /Length ${reg.ttfBuffer.length} /Length1 ${reg.ttfBuffer.length} >>\nstream\n`),
      reg.ttfBuffer,
      Buffer.from("\nendstream"),
    ]),
  );

  // F2: Bold Font (Type0)
  addObj(
    "<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans-Bold /Encoding /Identity-H /DescendantFonts [10 0 R] /ToUnicode 12 0 R >>",
  );
  // 10: CIDFontType2 (Bold)
  addObj(
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 11 0 R /CIDToGIDMap /Identity /W [0 65535 1000] >>",
  );
  // 11: FontDescriptor (Bold)
  addObj(
    `<< /Type /FontDescriptor /FontName /DejaVuSans-Bold /Flags 32 /FontBBox [-1029 -415 1681 1167] /ItalicAngle 0 /Ascent ${bold.ascent} /Descent ${bold.descent} /CapHeight 729 /StemV 100 /FontFile2 13 0 R >>`,
  );

  // 12: ToUnicode CMap (Bold)
  const cmapBold = buildCmap(usedGidsBold);
  addObj(`<< /Length ${cmapBold.length} >>\nstream\n${cmapBold}\nendstream`);

  // 13: FontFile2 (Bold TTF)
  addObj(
    Buffer.concat([
      Buffer.from(`<< /Length ${bold.ttfBuffer.length} /Length1 ${bold.ttfBuffer.length} >>\nstream\n`),
      bold.ttfBuffer,
      Buffer.from("\nendstream"),
    ]),
  );

  // 14: Content stream
  const contentStream = streamOps.join("\n");
  const contentBuf = Buffer.from(contentStream, "utf8");
  addObj(`<< /Length ${contentBuf.length} >>\nstream\n${contentStream}\nendstream`);

  // Assemble full PDF with xref table
  let offset = 0;
  const offsets: number[] = [];
  const parts: Buffer[] = [];

  function write(chunk: Buffer | string): void {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    parts.push(b);
    offset += b.length;
  }

  // PDF Header with binary bytes comment
  write(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    write(`${i + 1} 0 obj\n`);
    const obj = objects[i];
    if (obj) write(obj);
    write("\nendobj\n");
  }

  const xrefStart = offset;
  write(`xref\n0 ${objects.length + 1}\n`);
  write("0000000000 65535 f \n");
  for (let i = 0; i < objects.length; i++) {
    write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(parts);
}
