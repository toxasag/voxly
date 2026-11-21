import * as QRCode from "qrcode";
import type { InvoiceDTO } from "./finance.types.js";
import { amountToWords } from "./amount-to-words.js";
import {
  normalizeInvoiceFormConfig,
  type InvoiceIssuerSnapshot,
} from "./finance-organizations.types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoneyRu(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace(/\u00A0/g, " ");
}

function formatDateLongRu(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Формирование строки платежного QR-кода по ГОСТ Р 56042-2014 (ST00012).
 * Сканируется всеми банками РФ (Сбер, Т-Банк, Альфа, ВТБ, ОЗОН Банк, Точка и др.).
 */
export function buildGostPaymentQrString(
  invoice: InvoiceDTO,
  issuer: InvoiceIssuerSnapshot,
): string | null {
  const personalAcc = issuer.settlementAccount.replace(/\D+/g, "");
  const bic = issuer.bik.replace(/\D+/g, "");
  const bankName = issuer.bankName.trim();
  const name = issuer.name.trim();

  if (!personalAcc || !bic || !bankName || !name) {
    return null;
  }

  const parts: string[] = [
    "ST00012",
    `Name=${name}`,
    `PersonalAcc=${personalAcc}`,
    `BankName=${bankName}`,
    `BIC=${bic}`,
  ];

  const correspAcc = issuer.corrAccount.replace(/\D+/g, "");
  if (correspAcc) parts.push(`CorrespAcc=${correspAcc}`);

  const inn = issuer.inn.replace(/\D+/g, "");
  if (inn) parts.push(`PayeeINN=${inn}`);

  const kpp = issuer.kpp.replace(/\D+/g, "");
  if (kpp) parts.push(`KPP=${kpp}`);

  const sumKopecks = Math.round(invoice.total * 100);
  if (sumKopecks > 0) parts.push(`Sum=${sumKopecks}`);

  const dateText = formatDateLongRu(invoice.issueDate);
  const vatSuffix =
    invoice.vatRate > 0
      ? `В т.ч. НДС ${invoice.vatRate}% (${formatMoneyRu(invoice.vatAmount)} руб.)`
      : "Без НДС";
  parts.push(`Purpose=Оплата по счёту № ${invoice.invoiceNumber} от ${dateText}. ${vatSuffix}`);

  return parts.join("|");
}

function unitForSource(source: string): string {
  if (source === "repair_work") return "усл.";
  return "шт.";
}

export async function renderInvoiceRfHtml(
  invoice: InvoiceDTO,
  issuer: InvoiceIssuerSnapshot,
  options?: { autoPrint?: boolean },
): Promise<string> {
  const cfg = normalizeInvoiceFormConfig(issuer.invoiceConfig);
  const issueDateText = formatDateLongRu(invoice.issueDate);

  // Generate GOST payment QR SVG when enabled and bank requisites are filled
  let qrSvg = "";
  if (cfg.showQrCode) {
    const qrPayload = buildGostPaymentQrString(invoice, issuer);
    if (qrPayload) {
      try {
        qrSvg = await QRCode.toString(qrPayload, {
          type: "svg",
          margin: 1,
          width: 138,
          errorCorrectionLevel: "M",
        });
      } catch {
        qrSvg = "";
      }
    }
  }

  const lineItems = invoice.lineItems ?? [];
  const itemsHtml = lineItems
    .map((it, idx) => {
      const unit = unitForSource(it.source);
      const qtyStr = Number.isInteger(it.quantity)
        ? String(it.quantity)
        : String(Math.round(it.quantity * 100) / 100);
      return `
        <tr>
          <td class="col-num">${idx + 1}</td>
          <td class="col-name">${escapeHtml(it.description)}</td>
          <td class="col-qty">${escapeHtml(qtyStr)}</td>
          <td class="col-unit">${unit}</td>
          <td class="col-price">${formatMoneyRu(it.unitPrice)}</td>
          <td class="col-sum">${formatMoneyRu(it.total)}</td>
        </tr>`;
    })
    .join("");

  const rubles = Math.floor(invoice.total);
  const kopecks = Math.round((invoice.total - rubles) * 100);
  const amountWords = amountToWords(rubles, kopecks);

  const buyerName = invoice.companyName || invoice.contactName || "Покупатель";
  const buyerDetailsParts = [buyerName];
  if (invoice.companyInn) buyerDetailsParts.push(`ИНН ${invoice.companyInn}`);
  if (invoice.companyAddress) buyerDetailsParts.push(invoice.companyAddress);
  const buyerLine = buyerDetailsParts.join(", ");

  const supplierLineParts = [issuer.name || "Организация"];
  if (issuer.inn) supplierLineParts.push(`ИНН ${issuer.inn}`);
  if (issuer.kpp) supplierLineParts.push(`КПП ${issuer.kpp}`);
  const supplierLine = supplierLineParts.join(", ");

  const acts = Array.from(
    new Set(
      lineItems
        .map((li) => li.sourceLabel)
        .filter((s): s is string => Boolean(s && s.trim())),
    ),
  );

  const hasLogo = cfg.showLogo && Boolean(issuer.logoUrl && issuer.logoUrl.trim());
  const logoWidth = Math.max(48, Math.min(260, issuer.logoWidth || 140));
  const directorTitle = issuer.directorTitle || (issuer.orgType === "ooo" ? "Генеральный директор" : "Индивидуальный предприниматель");
  const directorName = issuer.directorName || "";

  const headerLines: string[] = [];
  if (issuer.legalAddress) headerLines.push(`<div>${escapeHtml(issuer.legalAddress)}</div>`);
  if (issuer.actualAddress && issuer.actualAddress !== issuer.legalAddress) {
    headerLines.push(`<div>${escapeHtml(issuer.actualAddress)}</div>`);
  }

  const contactLines: string[] = [];
  if (issuer.phone) contactLines.push(`<div>Телефон: ${escapeHtml(issuer.phone)}</div>`);
  if (cfg.showEdo && issuer.edoInfo) {
    contactLines.push(`<div class="edo-line">${escapeHtml(issuer.edoInfo)}</div>`);
  }
  if (issuer.email) contactLines.push(`<div>Эл.почта: ${escapeHtml(issuer.email)}</div>`);
  if (issuer.website) contactLines.push(`<div>Сайт: ${escapeHtml(issuer.website)}</div>`);

  const vatLabel =
    invoice.vatRate > 0 ? `В том числе НДС (${invoice.vatRate}%):` : "В том числе НДС:";
  const vatValue =
    invoice.vatRate > 0 ? formatMoneyRu(invoice.vatAmount) : "Без НДС";

  const onloadAttr = options?.autoPrint ? ' onload="window.print()"' : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Счёт на оплату № ${escapeHtml(invoice.invoiceNumber)} от ${escapeHtml(issueDateText)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 34px;
      background: #ffffff;
      color: #111111;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.42;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 780px;
      margin: 0 auto;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 18px;
    }
    .header-info {
      flex: 1;
      min-width: 0;
    }
    .org-title {
      font-size: 13px;
      font-weight: 600;
      color: #111111;
      margin-bottom: 8px;
    }
    .org-meta {
      font-size: 11.5px;
      color: #222222;
      margin-bottom: 8px;
    }
    .org-contacts {
      font-size: 11.5px;
      color: #222222;
    }
    .edo-line {
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .logo-wrap {
      flex-shrink: 0;
      text-align: right;
    }
    .logo-wrap img {
      max-width: ${logoWidth}px;
      max-height: 76px;
      object-fit: contain;
      display: block;
    }
    .notice-box {
      border: 1px solid #d4d4d8;
      background: #fafafa;
      padding: 7px 10px;
      font-size: 10px;
      color: #52525b;
      margin-bottom: 14px;
      border-radius: 3px;
    }
    .bank-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 22px;
      font-size: 11.5px;
    }
    .bank-table td {
      border: 1px solid #222222;
      padding: 4px 7px;
      vertical-align: top;
    }
    .bank-label {
      font-size: 9.5px;
      color: #444444;
      margin-top: 8px;
      display: block;
    }
    .bank-val-bold {
      font-weight: 500;
    }
    .mono {
      font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    .invoice-heading {
      text-align: center;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #111111;
      margin: 4px 0 18px;
    }
    .parties-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 18px;
    }
    .parties-table {
      flex: 1;
      border-collapse: collapse;
      font-size: 12px;
    }
    .parties-table td {
      padding: 3px 0;
      vertical-align: top;
    }
    .parties-label {
      width: 105px;
      color: #333333;
      padding-right: 8px;
      white-space: nowrap;
    }
    .parties-value {
      color: #111111;
    }
    .qr-block {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      padding: 4px 0 4px 8px;
    }
    .qr-svg {
      width: 116px;
      height: 116px;
      flex-shrink: 0;
    }
    .qr-svg svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .qr-caption {
      width: 108px;
      font-size: 10.5px;
      line-height: 1.35;
      color: #444444;
    }
    .qr-caption strong {
      display: block;
      font-size: 11.5px;
      color: #111111;
      margin-bottom: 4px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 11.5px;
    }
    .items-table th {
      border: 1px solid #222222;
      background: #f7f7f8;
      font-weight: 600;
      padding: 5px 7px;
      text-align: center;
      color: #111111;
    }
    .items-table td {
      border: 1px solid #222222;
      padding: 5px 7px;
      vertical-align: top;
    }
    .col-num { width: 32px; text-align: center; }
    .col-name { text-align: left; }
    .col-qty { width: 58px; text-align: right; font-variant-numeric: tabular-nums; }
    .col-unit { width: 46px; text-align: center; }
    .col-price { width: 92px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .col-sum { width: 100px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 14px;
    }
    .totals-table {
      border-collapse: collapse;
      min-width: 240px;
      font-size: 12px;
    }
    .totals-table td {
      padding: 2.5px 4px;
    }
    .totals-label {
      text-align: right;
      padding-right: 16px;
      color: #222222;
    }
    .totals-val {
      text-align: right;
      min-width: 96px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .totals-strong {
      font-weight: 700;
      color: #111111;
    }
    .words-block {
      font-size: 12px;
      color: #111111;
      padding-bottom: 10px;
      border-bottom: 1.5px solid #222222;
      margin-bottom: 24px;
    }
    .notes-block {
      font-size: 11px;
      color: #444444;
      margin-top: -14px;
      margin-bottom: 20px;
    }
    .signatures {
      margin-top: 24px;
      position: relative;
    }
    .sig-row {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 22px;
    }
    .sig-role {
      width: 96px;
      font-size: 12px;
      color: #111111;
      padding-bottom: 14px;
    }
    .sig-field {
      flex: 1;
      text-align: center;
      position: relative;
    }
    .sig-field-narrow {
      width: 145px;
      flex: none;
    }
    .sig-value {
      min-height: 22px;
      border-bottom: 1px solid #222222;
      padding: 0 6px 3px;
      font-size: 12px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .sig-caption {
      font-size: 9.5px;
      color: #555555;
      margin-top: 2px;
    }
    .sig-img {
      max-height: 44px;
      max-width: 120px;
      object-fit: contain;
      margin-bottom: -6px;
    }
    .stamp-overlay {
      position: absolute;
      right: 135px;
      top: -18px;
      max-width: 110px;
      max-height: 110px;
      object-fit: contain;
      opacity: 0.88;
      pointer-events: none;
    }
    .footer-note {
      margin-top: 18px;
      font-size: 10.5px;
      color: #666666;
    }
    @media print {
      body { padding: 0; }
      @page { size: A4 portrait; margin: 12mm 14mm; }
    }
  </style>
</head>
<body${onloadAttr}>
  <div class="sheet">
    ${
      cfg.showContactsHeader || hasLogo
        ? `<div class="header-top">
            <div class="header-info">
              ${
                cfg.showContactsHeader
                  ? `<div class="org-title">${escapeHtml(issuer.name || "Организация")}</div>
                     ${headerLines.length > 0 ? `<div class="org-meta">${headerLines.join("")}</div>` : ""}
                     ${contactLines.length > 0 ? `<div class="org-contacts">${contactLines.join("")}</div>` : ""}`
                  : ""
              }
            </div>
            ${
              hasLogo
                ? `<div class="logo-wrap"><img src="${escapeHtml(issuer.logoUrl)}" alt="Логотип" onerror="this.style.display='none'" /></div>`
                : ""
            }
          </div>`
        : ""
    }

    ${cfg.showNotice && cfg.noticeText ? `<div class="notice-box">${escapeHtml(cfg.noticeText)}</div>` : ""}

    <table class="bank-table">
      <tbody>
        <tr>
          <td colspan="2" rowspan="2" style="width: 58%;">
            <div class="bank-val-bold">${escapeHtml(issuer.bankName)}</div>
            <span class="bank-label">Банк получателя</span>
          </td>
          <td style="width: 9%;">БИК</td>
          <td class="mono" style="width: 33%;">${escapeHtml(issuer.bik)}</td>
        </tr>
        <tr>
          <td>Сч. №</td>
          <td class="mono">${escapeHtml(issuer.corrAccount)}</td>
        </tr>
        <tr>
          <td style="width: 29%;">ИНН &nbsp;&nbsp;<span class="mono">${escapeHtml(issuer.inn)}</span></td>
          <td style="width: 29%;">КПП &nbsp;&nbsp;<span class="mono">${escapeHtml(issuer.kpp)}</span></td>
          <td rowspan="2">Сч. №</td>
          <td rowspan="2" class="mono">${escapeHtml(issuer.settlementAccount)}</td>
        </tr>
        <tr>
          <td colspan="2">
            <div>${escapeHtml(issuer.name)}</div>
            <span class="bank-label">Получатель</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h1 class="invoice-heading">Счёт на оплату № ${escapeHtml(invoice.invoiceNumber)} от ${escapeHtml(issueDateText)}</h1>

    <div class="parties-row">
      <table class="parties-table">
        <tbody>
          <tr>
            <td class="parties-label">Поставщик:</td>
            <td class="parties-value">${escapeHtml(supplierLine)}</td>
          </tr>
          <tr>
            <td class="parties-label">Покупатель:</td>
            <td class="parties-value">${escapeHtml(buyerLine)}</td>
          </tr>
          ${
            cfg.showBasis && acts.length > 0
              ? `<tr>
                  <td class="parties-label">Основание:</td>
                  <td class="parties-value">Наряд-заказ(ы) ${escapeHtml(acts.join(", "))}</td>
                </tr>`
              : ""
          }
        </tbody>
      </table>
      ${
        qrSvg
          ? `<div class="qr-block">
              <div class="qr-svg">${qrSvg}</div>
              <div class="qr-caption">
                <strong>QR-код<br />для оплаты</strong>
                Отсканируйте код с помощью банковского приложения
              </div>
            </div>`
          : ""
      }
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th class="col-num">№</th>
          <th class="col-name">Товары (работы, услуги)</th>
          <th class="col-qty">Кол-во</th>
          <th class="col-unit">Ед.</th>
          <th class="col-price">Цена</th>
          <th class="col-sum">Сумма</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-wrap">
      <table class="totals-table">
        <tbody>
          <tr class="totals-strong">
            <td class="totals-label">Итого к оплате:</td>
            <td class="totals-val">${formatMoneyRu(invoice.total)}</td>
          </tr>
          <tr>
            <td class="totals-label">${vatLabel}</td>
            <td class="totals-val">${vatValue}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="words-block">
      Всего к оплате: ${escapeHtml(amountWords)}.
    </div>

    ${invoice.notes ? `<div class="notes-block"><strong>Примечание:</strong> ${escapeHtml(invoice.notes)}</div>` : ""}

    <div class="signatures">
      ${
        cfg.showStamp && issuer.stampUrl
          ? `<img class="stamp-overlay" src="${escapeHtml(issuer.stampUrl)}" alt="Печать" onerror="this.style.display='none'" />`
          : ""
      }
      <div class="sig-row">
        <div class="sig-role">Поставщик</div>
        <div class="sig-field">
          <div class="sig-value">${escapeHtml(directorTitle)}</div>
          <div class="sig-caption">должность</div>
        </div>
        <div class="sig-field sig-field-narrow">
          <div class="sig-value">
            ${
              cfg.showSignature && issuer.signatureUrl
                ? `<img class="sig-img" src="${escapeHtml(issuer.signatureUrl)}" alt="Подпись" onerror="this.style.display='none'" />`
                : ""
            }
          </div>
          <div class="sig-caption">подпись</div>
        </div>
        <div class="sig-field sig-field-narrow">
          <div class="sig-value">${escapeHtml(directorName)}</div>
          <div class="sig-caption">расшифровка подписи</div>
        </div>
      </div>

      ${
        cfg.showAccountant && issuer.accountantName
          ? `<div class="sig-row">
              <div class="sig-role">Бухгалтер</div>
              <div class="sig-field">
                <div class="sig-value">Главный бухгалтер</div>
                <div class="sig-caption">должность</div>
              </div>
              <div class="sig-field sig-field-narrow">
                <div class="sig-value"></div>
                <div class="sig-caption">подпись</div>
              </div>
              <div class="sig-field sig-field-narrow">
                <div class="sig-value">${escapeHtml(issuer.accountantName)}</div>
                <div class="sig-caption">расшифровка подписи</div>
              </div>
            </div>`
          : ""
      }
    </div>

    ${cfg.footerNote ? `<div class="footer-note">${escapeHtml(cfg.footerNote)}</div>` : ""}
  </div>
</body>
</html>`;
}
