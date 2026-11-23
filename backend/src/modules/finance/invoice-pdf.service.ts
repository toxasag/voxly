import fs from "node:fs";
import path from "node:path";
import * as QRCode from "qrcode";
import type { InvoiceDTO } from "./finance.types.js";
import { amountToWords } from "./amount-to-words.js";
import { buildGostPaymentQrString } from "./invoice-html.service.js";
import {
  normalizeInvoiceFormConfig,
  type InvoiceIssuerSnapshot,
} from "./finance-organizations.types.js";

interface PrintSettings {
  company_name?: string;
  company_address?: string;
  actual_address?: string;
  company_phone?: string;
  company_email?: string;
  company_website?: string;
  edo_info?: string;
  company_inn?: string;
  company_ogrn?: string;
  bank_name?: string;
  bik?: string;
  corr_account?: string;
  settlement_account?: string;
  company_kpp?: string;
  director_title?: string;
  director_name?: string;
  accountant_name?: string;
  show_qr_code?: boolean;
  show_notice?: boolean;
  notice_text?: string;
  show_accountant?: boolean;
  show_basis?: boolean;
}

interface FontMetrics {
  charToGid: (code: number) => number;
  getWidth: (gid: number, fontSize: number) => number;
  getRawWidth: (gid: number) => number;
  unitsPerEm: number;
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
  const rawAscent = hheaOffset ? buf.readInt16BE(hheaOffset + 4) : 928;
  const rawDescent = hheaOffset ? buf.readInt16BE(hheaOffset + 6) : -236;
  const ascent = Math.round((rawAscent / unitsPerEm) * 1000);
  const descent = Math.round((rawDescent / unitsPerEm) * 1000);
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

  const getRawWidth = (gid: number): number => {
    if (gid < numOfLongHorMetrics) {
      return buf.readUInt16BE(hmtxOffset + gid * 4);
    }
    return buf.readUInt16BE(hmtxOffset + (numOfLongHorMetrics - 1) * 4);
  };

  const getWidth = (gid: number, fontSize: number): number => {
    const raw = getRawWidth(gid);
    return (raw / unitsPerEm) * fontSize;
  };

  return { charToGid, getWidth, getRawWidth, unitsPerEm, ttfBuffer: buf, ascent, descent };
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
  })
    .format(val)
    .replace(/\u00A0/g, " ");
}

function buildWidthsArray(usedMap: Map<number, number>, font: FontMetrics): string {
  const gids = Array.from(usedMap.keys()).sort((a, b) => a - b);
  if (gids.length === 0) return "[0 [1000]]";

  const entries: string[] = [];
  let i = 0;
  while (i < gids.length) {
    const startGid = gids[i]!;
    const group: number[] = [];
    let currentGid = startGid;
    while (i < gids.length && gids[i] === currentGid) {
      const raw = font.getRawWidth(currentGid);
      const pdfW = Math.round((raw / font.unitsPerEm) * 1000);
      group.push(pdfW);
      currentGid++;
      i++;
    }
    entries.push(`${startGid} [${group.join(" ")}]`);
  }
  return `[ ${entries.join(" ")} ]`;
}

export function generateInvoicePdfBuffer(
  invoice: InvoiceDTO,
  settings: PrintSettings = {},
): Buffer {
  const { reg, bold } = getFonts();

  // Page dimensions (A4: 595.28 x 841.89 pt)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 35;
  const contentWidth = pageWidth - marginX * 2; // 525.28 pt

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
    if (!text) return [];
    const words = text.split(" ");
    const lines: string[] = [];
    let curLine = "";

    for (const w of words) {
      const testLine = curLine ? `${curLine} ${w}` : w;
      if (measureText(testLine, fontSize, isBold) <= maxWidth) {
        curLine = testLine;
      } else {
        if (curLine) lines.push(curLine);
        if (measureText(w, fontSize, isBold) > maxWidth) {
          let chunk = "";
          for (let i = 0; i < w.length; i++) {
            const testChunk = chunk + w[i];
            if (measureText(testChunk, fontSize, isBold) <= maxWidth) {
              chunk = testChunk;
            } else {
              if (chunk) lines.push(chunk);
              chunk = w[i] ?? "";
            }
          }
          curLine = chunk;
        } else {
          curLine = w;
        }
      }
    }
    if (curLine) lines.push(curLine);
    return lines;
  }

  // Current drawing cursor from top
  let curY = pageHeight - 35;

  // 1. Notice / Disclaimer Box at top (optional)
  if (settings.show_notice && settings.notice_text) {
    const noticeLines = wrapText(settings.notice_text, contentWidth - 16, 7.5, false);
    const boxH = Math.max(16, noticeLines.length * 10 + 8);
    curY -= boxH;
    drawRect(marginX, curY, contentWidth, boxH, 0.5, "0.75 0.75 0.75", "0.96 0.96 0.96");
    noticeLines.forEach((l, idx) => {
      drawText(l, marginX + 8, curY + boxH - 10 - idx * 10, 7.5, false, "0.25 0.25 0.25");
    });
    curY -= 10;
  }

  // 2. Bank Requisites Table (Образец заполнения платежного поручения РФ)
  const bankTableH = 74;
  curY -= bankTableH;
  const bY = curY;
  const bX = marginX;
  const bW = contentWidth;

  // Outer border
  drawRect(bX, bY, bW, bankTableH, 0.75, "0.15 0.15 0.15");

  const colBankW = 295;
  const colBikLabelW = 44;

  // Split lines
  // Vertical: Bank/Beneficiary left column vs BIK/Accounts right column
  drawLine(bX + colBankW, bY, bX + colBankW, bY + bankTableH, 0.5, "0.15 0.15 0.15");
  // Vertical: BIK/Acc labels vs numbers
  drawLine(bX + colBankW + colBikLabelW, bY, bX + colBankW + colBikLabelW, bY + bankTableH, 0.5, "0.15 0.15 0.15");
  // Horizontal middle dividing line
  drawLine(bX, bY + 38, bX + bW, bY + 38, 0.5, "0.15 0.15 0.15");
  // Horizontal right top: BIK vs Corr Acc
  drawLine(bX + colBankW, bY + 56, bX + bW, bY + 56, 0.5, "0.15 0.15 0.15");
  // Horizontal left bottom: INN/KPP vs Beneficiary name
  drawLine(bX, bY + 22, bX + colBankW, bY + 22, 0.5, "0.15 0.15 0.15");
  // Vertical left bottom: INN vs KPP
  drawLine(bX + 145, bY + 22, bX + 145, bY + 38, 0.5, "0.15 0.15 0.15");

  const bankName = settings.bank_name || "";
  const bik = settings.bik || "";
  const corrAcc = settings.corr_account || "";
  const settAcc = settings.settlement_account || "";
  const inn = settings.company_inn || "";
  const kpp = settings.company_kpp || "";
  const compName = settings.company_name || "Организация";

  // Bank name & caption
  drawText(bankName, bX + 6, bY + 60, 8.5, false);
  drawText("Банк получателя", bX + 6, bY + 42, 7, false, "0.45 0.45 0.45");

  // BIK
  drawText("БИК", bX + colBankW + 5, bY + 62, 8, false);
  drawText(bik, bX + colBankW + colBikLabelW + 6, bY + 62, 8.5, false);

  // Corr Account
  drawText("Сч. №", bX + colBankW + 5, bY + 44, 8, false);
  drawText(corrAcc, bX + colBankW + colBikLabelW + 6, bY + 44, 8.5, false);

  // INN / KPP
  drawText("ИНН", bX + 6, bY + 26, 8, false);
  drawText(inn, bX + 32, bY + 26, 8.5, false);
  drawText("КПП", bX + 151, bY + 26, 8, false);
  drawText(kpp, bX + 177, bY + 26, 8.5, false);

  // Settlement Account
  drawText("Сч. №", bX + colBankW + 5, bY + 16, 8, false);
  drawText(settAcc, bX + colBankW + colBikLabelW + 6, bY + 16, 8.5, false);

  // Beneficiary Name & caption
  const compLines = wrapText(compName, colBankW - 12, 8.5, false);
  if (compLines.length === 1) {
    drawText(compLines[0]!, bX + 6, bY + 11, 8.5, false);
    drawText("Получатель", bX + 6, bY + 3, 6.5, false, "0.45 0.45 0.45");
  } else {
    drawText(compLines[0]!, bX + 6, bY + 12, 7.5, false);
    drawText(compLines[1]!, bX + 6, bY + 5, 7.5, false);
    drawText("Получатель", bX + colBankW - measureText("Получатель", 6.5, false) - 6, bY + 3, 6.5, false, "0.45 0.45 0.45");
  }

  curY -= 20;

  // 3. Invoice Title & Thick Accent Line
  const issueDateFormatted = formatDateRu(invoice.issueDate);
  const titleText = `Счёт на оплату № ${invoice.invoiceNumber} от ${issueDateFormatted}`;
  drawText(titleText, marginX, curY, 14, true, "0.05 0.05 0.05");

  curY -= 6;
  drawLine(marginX, curY, marginX + contentWidth, curY, 1.5, "0 0 0");

  curY -= 14;

  // 4. Supplier, Buyer + GOST R 56042-2014 Vector Payment QR Code
  const qrSnapshot: InvoiceIssuerSnapshot = {
    name: compName,
    inn,
    kpp,
    ogrn: settings.company_ogrn || "",
    legalAddress: settings.company_address || "",
    actualAddress: settings.actual_address || "",
    phone: settings.company_phone || "",
    email: settings.company_email || "",
    website: settings.company_website || "",
    edoInfo: settings.edo_info || "",
    bankName,
    bik,
    corrAccount: corrAcc,
    settlementAccount: settAcc,
    directorTitle: settings.director_title || "Индивидуальный предприниматель",
    directorName: settings.director_name || "",
    accountantName: settings.accountant_name || "",
    logoUrl: "",
    logoWidth: 140,
    stampUrl: "",
    signatureUrl: "",
    invoiceConfig: normalizeInvoiceFormConfig({}),
  };

  const qrPayload = settings.show_qr_code !== false ? buildGostPaymentQrString(invoice, qrSnapshot) : null;
  const hasQr = Boolean(qrPayload);

  // Layout boundaries: QR on the right, Parties on the left
  const qrBoxSize = 78;
  const qrBlockW = hasQr ? 142 : 0;
  const partiesMaxW = hasQr ? contentWidth - qrBlockW - 16 : contentWidth;
  const labelW = 66;
  const valueW = partiesMaxW - labelW;

  const partiesStartY = curY;
  let partiesCurY = curY;

  // Supplier
  const supAddress = settings.company_address || settings.actual_address || "";
  const supPhone = settings.company_phone ? `тел.: ${settings.company_phone}` : "";
  const supDetails = `${compName}${inn ? `, ИНН ${inn}` : ""}${kpp ? `, КПП ${kpp}` : ""}${supAddress ? `, ${supAddress}` : ""}${supPhone ? `, ${supPhone}` : ""}`;
  const supLines = wrapText(supDetails, valueW, 8.5, false);

  drawText("Поставщик:", marginX, partiesCurY, 8.5, true, "0.1 0.1 0.1");
  supLines.forEach((l, idx) => {
    drawText(l, marginX + labelW, partiesCurY - idx * 11, 8.5, false);
  });
  partiesCurY -= supLines.length * 11 + 6;

  // Buyer
  const buyerName = invoice.companyName || invoice.contactName || "Физическое лицо";
  const buyerInn = invoice.companyInn ? `ИНН ${invoice.companyInn}` : "";
  const buyerAddr = invoice.companyAddress ? invoice.companyAddress : "";
  const buyerPhone = invoice.contactPhone ? `тел.: ${invoice.contactPhone}` : "";
  const buyerDetails = [buyerName, buyerInn, buyerAddr, buyerPhone].filter(Boolean).join(", ");
  const buyLines = wrapText(buyerDetails, valueW, 8.5, false);

  drawText("Покупатель:", marginX, partiesCurY, 8.5, true, "0.1 0.1 0.1");
  buyLines.forEach((l, idx) => {
    drawText(l, marginX + labelW, partiesCurY - idx * 11, 8.5, false);
  });
  partiesCurY -= buyLines.length * 11 + 6;

  // Basis (if available)
  const lineItems = invoice.lineItems ?? [];
  const acts = Array.from(
    new Set(
      lineItems
        .map((li) => li.sourceLabel)
        .filter((s): s is string => Boolean(s && s.trim())),
    ),
  );
  let basisText = "";
  if (settings.show_basis !== false) {
    if (acts.length > 0) {
      basisText = `Заказ-наряд(ы) ${acts.join(", ")}`;
    } else if (invoice.notes) {
      basisText = invoice.notes;
    } else if (invoice.repairOrderId) {
      basisText = "Заказ-наряд";
    }
  }

  if (basisText) {
    const basisLines = wrapText(basisText, valueW, 8.5, false);
    drawText("Основание:", marginX, partiesCurY, 8.5, true, "0.1 0.1 0.1");
    basisLines.forEach((l, idx) => {
      drawText(l, marginX + labelW, partiesCurY - idx * 11, 8.5, false);
    });
    partiesCurY -= basisLines.length * 11 + 6;
  }

  // Draw QR code on right
  let qrBottomY = partiesStartY;
  if (qrPayload) {
    try {
      const qr = QRCode.create(qrPayload, { errorCorrectionLevel: "M" });
      const size = qr.modules.size;
      const cell = qrBoxSize / size;
      const qrX = marginX + contentWidth - qrBlockW;
      const qrTopY = partiesStartY + 2;
      qrBottomY = qrTopY - qrBoxSize;

      streamOps.push("q 0 0 0 rg");
      for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
          if (qr.modules.get(r, c)) {
            const rx = qrX + c * cell;
            const ry = qrTopY - (r + 1) * cell;
            streamOps.push(
              `${rx.toFixed(2)} ${ry.toFixed(2)} ${(cell + 0.05).toFixed(2)} ${(cell + 0.05).toFixed(2)} re f`,
            );
          }
        }
      }
      streamOps.push("Q");

      const capX = qrX + qrBoxSize + 7;
      drawText("QR-код", capX, qrTopY - 12, 8, true, "0.1 0.1 0.1");
      drawText("для оплаты", capX, qrTopY - 21, 8, true, "0.1 0.1 0.1");
      drawText("Отсканируйте", capX, qrTopY - 33, 6.5, false, "0.4 0.4 0.4");
      drawText("в банковском", capX, qrTopY - 41, 6.5, false, "0.4 0.4 0.4");
      drawText("приложении", capX, qrTopY - 49, 6.5, false, "0.4 0.4 0.4");
    } catch {
      // ignore QR draw error
    }
  }

  curY = Math.min(partiesCurY, qrBottomY - 10) - 6;

  // 5. Line Items Table
  const col1W = 24; // №
  const col3W = 48; // Кол-во
  const col4W = 36; // Ед.
  const col5W = 72; // Цена
  const col6W = 82; // Сумма
  const col2W = contentWidth - (col1W + col3W + col4W + col5W + col6W); // Name

  const headerH = 20;
  curY -= headerH;
  drawRect(marginX, curY, contentWidth, headerH, 0.75, "0.2 0.2 0.2", "0.93 0.93 0.93");

  const x1 = marginX;
  const x2 = x1 + col1W;
  const x3 = x2 + col2W;
  const x4 = x3 + col3W;
  const x5 = x4 + col4W;
  const x6 = x5 + col5W;

  drawLine(x2, curY, x2, curY + headerH, 0.5, "0.2 0.2 0.2");
  drawLine(x3, curY, x3, curY + headerH, 0.5, "0.2 0.2 0.2");
  drawLine(x4, curY, x4, curY + headerH, 0.5, "0.2 0.2 0.2");
  drawLine(x5, curY, x5, curY + headerH, 0.5, "0.2 0.2 0.2");
  drawLine(x6, curY, x6, curY + headerH, 0.5, "0.2 0.2 0.2");

  drawText("№", x1 + (col1W - measureText("№", 8, true)) / 2, curY + 6, 8, true);
  drawText("Товары (работы, услуги)", x2 + 6, curY + 6, 8, true);
  drawText("Кол-во", x3 + (col3W - measureText("Кол-во", 8, true)) / 2, curY + 6, 8, true);
  drawText("Ед.", x4 + (col4W - measureText("Ед.", 8, true)) / 2, curY + 6, 8, true);
  drawText("Цена", x5 + col5W - measureText("Цена", 8, true) - 6, curY + 6, 8, true);
  drawText("Сумма", x6 + col6W - measureText("Сумма", 8, true) - 6, curY + 6, 8, true);

  // Table rows
  lineItems.forEach((item, index) => {
    const itemTitle = item.description;
    const lines = wrapText(itemTitle, col2W - 12, 8, false);
    const rowH = Math.max(18, lines.length * 11 + 7);
    curY -= rowH;

    drawRect(marginX, curY, contentWidth, rowH, 0.5, "0.25 0.25 0.25");

    drawLine(x2, curY, x2, curY + rowH, 0.5, "0.25 0.25 0.25");
    drawLine(x3, curY, x3, curY + rowH, 0.5, "0.25 0.25 0.25");
    drawLine(x4, curY, x4, curY + rowH, 0.5, "0.25 0.25 0.25");
    drawLine(x5, curY, x5, curY + rowH, 0.5, "0.25 0.25 0.25");
    drawLine(x6, curY, x6, curY + rowH, 0.5, "0.25 0.25 0.25");

    const idxStr = String(index + 1);
    drawText(idxStr, x1 + (col1W - measureText(idxStr, 8, false)) / 2, curY + rowH - 12, 8, false);

    lines.forEach((l, lIdx) => {
      drawText(l, x2 + 6, curY + rowH - 12 - lIdx * 11, 8, false);
    });

    const qtyStr = Number.isInteger(item.quantity)
      ? String(item.quantity)
      : String(Math.round(item.quantity * 100) / 100);
    drawText(qtyStr, x3 + (col3W - measureText(qtyStr, 8, false)) / 2, curY + rowH - 12, 8, false);

    const unitStr = item.source === "repair_work" ? "усл." : "шт.";
    drawText(unitStr, x4 + (col4W - measureText(unitStr, 8, false)) / 2, curY + rowH - 12, 8, false);

    const priceStr = formatRubles(item.unitPrice);
    const totalStr = formatRubles(item.total);
    drawText(priceStr, x5 + col5W - measureText(priceStr, 8, false) - 6, curY + rowH - 12, 8, false);
    drawText(totalStr, x6 + col6W - measureText(totalStr, 8, false) - 6, curY + rowH - 12, 8, false);
  });

  curY -= 12;

  // 6. Totals block (right-aligned)
  const totalsX = marginX + contentWidth - 210;
  const totalValStr = formatRubles(invoice.total);

  drawText("Итого к оплате:", totalsX, curY, 9, true);
  drawText(totalValStr, marginX + contentWidth - measureText(totalValStr, 9, true) - 6, curY, 9, true);
  curY -= 14;

  const vatRate = invoice.vatRate ?? 0;
  if (vatRate > 0) {
    const vatStr = formatRubles(invoice.vatAmount);
    drawText(`В том числе НДС (${vatRate}%):`, totalsX, curY, 8.5, false);
    drawText(vatStr, marginX + contentWidth - measureText(vatStr, 8.5, false) - 6, curY, 8.5, false);
  } else {
    drawText("В том числе НДС:", totalsX, curY, 8.5, false);
    const noVat = "Без НДС";
    drawText(noVat, marginX + contentWidth - measureText(noVat, 8.5, false) - 6, curY, 8.5, false);
  }

  curY -= 16;

  // 7. Amount in words
  const itemsCountText = `Всего наименований ${lineItems.length}, на сумму ${formatRubles(invoice.total)} руб.`;
  drawText(itemsCountText, marginX, curY, 8.5, false);
  curY -= 12;

  const rubles = Math.floor(invoice.total);
  const kopecks = Math.round((invoice.total - rubles) * 100);
  const wordsStr = `Всего к оплате: ${amountToWords(rubles, kopecks)}.`;
  drawText(wordsStr, marginX, curY, 8.5, true);

  curY -= 6;
  drawLine(marginX, curY, marginX + contentWidth, curY, 1.5, "0 0 0");

  curY -= 28;

  // 8. Signatures Block
  const dirTitle = settings.director_title || "Индивидуальный предприниматель";
  const sigDirector = settings.director_name || "";

  drawText("Поставщик", marginX, curY, 8.5, true);

  // Position
  const dirTitleTrunc = wrapText(dirTitle, 160, 8, false)[0] || dirTitle;
  drawText(dirTitleTrunc, marginX + 75, curY + 2, 8, false);
  drawLine(marginX + 70, curY - 2, marginX + 235, curY - 2, 0.5, "0.2 0.2 0.2");
  drawText("должность", marginX + 130, curY - 10, 6.5, false, "0.4 0.4 0.4");

  // Signature
  drawLine(marginX + 250, curY - 2, marginX + 360, curY - 2, 0.5, "0.2 0.2 0.2");
  drawText("подпись", marginX + 290, curY - 10, 6.5, false, "0.4 0.4 0.4");

  // Signature Full Name
  drawText(sigDirector, marginX + 380, curY + 2, 8.5, false);
  drawLine(marginX + 375, curY - 2, marginX + contentWidth, curY - 2, 0.5, "0.2 0.2 0.2");
  drawText("расшифровка подписи", marginX + 415, curY - 10, 6.5, false, "0.4 0.4 0.4");

  if (settings.show_accountant && settings.accountant_name) {
    curY -= 26;
    drawText("Бухгалтер", marginX, curY, 8.5, true);
    drawText("Главный бухгалтер", marginX + 75, curY + 2, 8, false);
    drawLine(marginX + 70, curY - 2, marginX + 235, curY - 2, 0.5, "0.2 0.2 0.2");
    drawText("должность", marginX + 130, curY - 10, 6.5, false, "0.4 0.4 0.4");

    drawLine(marginX + 250, curY - 2, marginX + 360, curY - 2, 0.5, "0.2 0.2 0.2");
    drawText("подпись", marginX + 290, curY - 10, 6.5, false, "0.4 0.4 0.4");

    drawText(settings.accountant_name, marginX + 380, curY + 2, 8.5, false);
    drawLine(marginX + 375, curY - 2, marginX + contentWidth, curY - 2, 0.5, "0.2 0.2 0.2");
    drawText("расшифровка подписи", marginX + 415, curY - 10, 6.5, false, "0.4 0.4 0.4");
  }

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
  // 5: CIDFontType2 (Reg) with exact glyph widths
  addObj(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /CIDToGIDMap /Identity /DW 1000 /W ${buildWidthsArray(usedGidsReg, reg)} >>`,
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
  // 10: CIDFontType2 (Bold) with exact glyph widths
  addObj(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 11 0 R /CIDToGIDMap /Identity /DW 1000 /W ${buildWidthsArray(usedGidsBold, bold)} >>`,
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
